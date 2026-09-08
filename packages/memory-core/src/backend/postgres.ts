import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { parseDocument, stringify } from 'yaml';
import type { MemoryConfig } from '../config.js';
import { MemoryConflictError, MemoryError } from '../errors.js';
import { isUlid } from '../identities.js';
import type { MemoryRecord, MemoryTombstone, RecordType } from '../schemas.js';
import { createSecretScanner, type SecretScanner } from '../security.js';
import { RECORD_FOLDERS, safeProjectPath, type MemoryRecordInput } from './filesystem.js';
import {
  collectSearchResults,
  makeRecord as makeRecordHelper,
  makeTombstone as makeTombstoneHelper,
  searchableText,
  validateCompactness as validateCompactnessHelper,
  validateRecord as validateRecordHelper,
  validateTombstone as validateTombstoneHelper,
  assertAcyclic,
  type RecordHelperDeps,
} from './record-helpers.js';
import type {
  BackendSearchOptions,
  CacheValidation,
  NamespaceScope,
  ShardState,
  StorageBackend,
  StorageReplacement,
} from './types.js';

/**
 * Postgres backend (issue #6): records live as JSONB documents in
 * PostgreSQL; the database is both canonical store and search index.
 *
 * - Shard separation via (organization_id, project_id, scope) columns
 * - Concurrency via pg_advisory_xact_lock(shard) + unique constraints
 * - BM25 search through pg_textsearch when the extension is available
 *   (ranked with the <@> operator); otherwise a tsvector/ts_rank baseline
 *   (graceful degradation, per the design)
 * - The "path" namespace of StorageReplacement maps onto row upserts:
 *   `facts/<ULID>.yaml` -> record row, `tombstones/<ULID>.yaml` -> tombstone
 */

export interface PostgresBackendOptions {
  readonly config: MemoryConfig;
  readonly cwd: string;
  readonly onStaleCache?: () => boolean | Promise<boolean>;
}

/** Resolved Postgres connection parameters. */
export interface PgConnectionSettings {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly ssl: boolean;
  readonly user?: string;
  readonly password?: string;
}

/** Expands ${VAR} credential references from the environment. */
export function resolvePgSettings(config: MemoryConfig, env: NodeJS.ProcessEnv = process.env): PgConnectionSettings {
  const pg = config.provider.db.pg;
  const resolveCredential = (value: string | undefined, fallbackEnv: string, label: string): string | undefined => {
    if (value === undefined) {
      const fallback = env[fallbackEnv];
      if (fallback === undefined || fallback === '') return undefined;
      return fallback;
    }
    if (!/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u.test(value)) return value;
    const varName = value.slice(2, -1);
    const expanded = env[varName];
    if (expanded === undefined || expanded === '')
      throw new MemoryError(
        `Credential reference '${value}' at skills.memory.${label} points to unset env var '${varName}'.`,
      );
    return expanded;
  };
  return {
    host: pg.host,
    port: pg.port,
    database: pg.database,
    ssl: pg.ssl,
    user: resolveCredential(pg.user, 'NEOTTIA_MEMORY_DB_PG_USER', 'provider.db.pg.user'),
    password: resolveCredential(pg.password, 'NEOTTIA_MEMORY_DB_PG_PASSWORD', 'provider.db.pg.password'),
  };
}

export class PostgresBackend implements StorageBackend {
  private readonly pool: pg.Pool;
  private readonly scope: NamespaceScope;
  private readonly helperDeps: RecordHelperDeps;
  private readonly scanner: SecretScanner;
  private textSearchKind: 'pg_textsearch' | 'tsvector' = 'tsvector';
  private schemaReady = false;
  /** Client bound to the active withLock transaction, if any. */
  private readonly txContext = new AsyncLocalStorage<pg.PoolClient>();

  public constructor(options: PostgresBackendOptions) {
    const settings = resolvePgSettings(options.config);
    this.scope = {
      organizationId: options.config.namespace.organization_id,
      projectId: options.config.namespace.project_id,
      scope: options.config.namespace.scope,
    };
    this.scanner = createSecretScanner({
      customPatterns: options.config.security.secret_patterns,
      entropyHeuristic: options.config.security.entropy_heuristic,
    });
    this.helperDeps = {
      scope: this.scope,
      scanner: this.scanner,
      defaultTopic: options.config.namespace.default_topic,
    };
    this.pool = new pg.Pool({
      host: settings.host,
      port: settings.port,
      database: settings.database,
      // Certificate verification stays enabled; deployments with a private
      // CA should mount it and configure sslrootcert in the connection.
      ssl: settings.ssl,
      user: settings.user,
      password: settings.password,
      max: 4,
    });
  }

  // -- schema ---------------------------------------------------------------

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        memory_type TEXT NOT NULL,
        record_type TEXT NOT NULL,
        topic TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        created_by TEXT NOT NULL,
        supersedes JSONB NOT NULL DEFAULT '[]',
        tags JSONB NOT NULL DEFAULT '[]',
        document JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_records_active
        ON memory_records (created_at DESC);
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS memory_tombstones (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        target_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        document JSONB NOT NULL
      );
    `);
    await this.pool.query(`ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global'`);
    await this.pool.query(
      `ALTER TABLE memory_tombstones ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global'`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS memory_records_shard ON memory_records (organization_id, project_id, scope, created_at DESC);`,
    );
    await this.pool.query(`CREATE INDEX IF NOT EXISTS memory_tombstones_target ON memory_tombstones (target_id);`);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS memory_tombstones_shard ON memory_tombstones (organization_id, project_id, scope);`,
    );

    // Search column for the tsvector baseline; pg_textsearch indexes the
    // same expression via a generated column below when available.
    await this.pool.query(`
      ALTER TABLE memory_records
        ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS memory_records_tsvector
        ON memory_records USING gin (to_tsvector('english', search_text));
    `);

    // Feature detection: pg_textsearch (BM25) outranks the tsvector baseline.
    const extension = await this.pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_textsearch'`);
    try {
      if (extension.rowCount === 0) await this.pool.query(`CREATE EXTENSION IF NOT EXISTS pg_textsearch;`);
      await this.pool.query(
        `CREATE INDEX IF NOT EXISTS memory_records_bm25 ON memory_records USING bm25 (search_text) WITH (text_config = 'english');`,
      );
      this.textSearchKind = 'pg_textsearch';
    } catch {
      // An installed but incompatible extension must not prevent the
      // tsvector-ranked fallback from serving the memory tools.
      this.textSearchKind = 'tsvector';
    }
    this.schemaReady = true;
  }

  // -- state ----------------------------------------------------------------

  /** {@inheritdoc StorageBackend.loadState} */
  public async loadState(): Promise<ShardState> {
    await this.ensureSchema();
    const executor = this.currentClient() ?? this.pool;
    const recordsResult = await executor.query(
      `SELECT document FROM memory_records
       WHERE organization_id = $1 AND project_id = $2 AND scope = $3
       ORDER BY created_at DESC`,
      [this.scope.organizationId, this.scope.projectId, this.scope.scope],
    );
    const tombstoneResult = await executor.query(
      `SELECT document FROM memory_tombstones
       WHERE organization_id = $1 AND project_id = $2 AND scope = $3
       ORDER BY created_at DESC`,
      [this.scope.organizationId, this.scope.projectId, this.scope.scope],
    );

    const records = recordsResult.rows.map((row) => validateRecordHelper(row.document, this.helperDeps));
    const tombstones = tombstoneResult.rows.map((row) => validateTombstoneHelper(row.document, this.helperDeps));

    const recordIds = new Set(records.map((record) => record.id));
    for (const record of records)
      for (const target of record.supersedes)
        if (!recordIds.has(target)) throw new MemoryError(`Broken supersedes reference: ${target}`);
    for (const tombstone of tombstones)
      if (!recordIds.has(tombstone.target_id))
        throw new MemoryError(`Broken tombstone reference: ${tombstone.target_id}`);
    assertAcyclic(records);

    const inactive = new Set(records.flatMap((record) => record.supersedes));
    tombstones.forEach((item) => inactive.add(item.target_id));

    const digests = [...recordsResult.rows, ...tombstoneResult.rows].map((row) =>
      createHash('sha256').update(JSON.stringify(row.document)).digest('hex'),
    );
    const contentHash = createHash('sha256').update(digests.sort().join('\n')).digest('hex');

    return {
      records,
      tombstones,
      activeIds: new Set(records.filter((record) => !inactive.has(record.id)).map((record) => record.id)),
      contentHash,
    };
  }

  // -- mutation ---------------------------------------------------------------

  /** {@inheritdoc StorageBackend.applyBatch} — upserts in one transaction. */
  public async applyBatch(replacements: readonly StorageReplacement[]): Promise<void> {
    const bound = this.currentClient();
    if (bound) {
      // Inside withLock: the caller's transaction already holds the shard
      // lock and provides atomicity.
      for (const replacement of replacements) {
        await this.applyReplacement(bound, replacement);
      }
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [this.shardKey()]);
      for (const replacement of replacements) {
        await this.applyReplacement(client, replacement);
      }
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error instanceof MemoryError ? error : new MemoryError(describe(error));
    } finally {
      client.release();
    }
  }

  private async applyReplacement(client: pg.PoolClient, replacement: StorageReplacement): Promise<void> {
    const parsed = this.parsePath(replacement.path);
    if (replacement.bytes === undefined) {
      // Shard-scoped delete: the advisory lock does not enforce row ownership.
      await client.query(
        `DELETE FROM ${parsed.table}
         WHERE id = $1 AND organization_id = $2 AND project_id = $3 AND scope = $4`,
        [parsed.id, this.scope.organizationId, this.scope.projectId, this.scope.scope],
      );
      return;
    }
    const document = parseDocumentBytes(replacement.bytes, replacement.path);
    if (parsed.table === 'memory_tombstones') {
      const tombstone = validateTombstoneHelper(document, this.helperDeps);
      if (tombstone.id !== parsed.id)
        throw new MemoryError(`Memory path does not match tombstone ID: ${replacement.path}`);
      if (replacement.exclusive)
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [this.shardKey(), tombstone.id]);
      const tombstoneValues = [
        tombstone.id,
        tombstone.organization_id,
        tombstone.project_id,
        this.scope.scope,
        tombstone.target_id,
        tombstone.created_at,
        JSON.stringify(tombstone),
      ];
      const tombstoneInsert = replacement.exclusive
        ? `INSERT INTO memory_tombstones (id, organization_id, project_id, scope, target_id, created_at, document)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`
        : `INSERT INTO memory_tombstones (id, organization_id, project_id, scope, target_id, created_at, document)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET target_id = EXCLUDED.target_id, created_at = EXCLUDED.created_at, document = EXCLUDED.document
           WHERE memory_tombstones.organization_id = EXCLUDED.organization_id
             AND memory_tombstones.project_id = EXCLUDED.project_id
             AND memory_tombstones.scope = EXCLUDED.scope`;
      try {
        const result = await client.query(tombstoneInsert, tombstoneValues);
        if (!replacement.exclusive && result.rowCount === 0)
          throw new MemoryConflictError(`Memory ID belongs to another namespace: ${replacement.path}`);
      } catch (error: unknown) {
        if (replacement.exclusive && isUniqueViolation(error))
          throw new MemoryConflictError(`Memory path already exists: ${replacement.path}`);
        throw error;
      }
      return;
    }
    const record = validateRecordHelper(document, this.helperDeps);
    if (record.id !== parsed.id || parsed.recordType !== record.record_type)
      throw new MemoryError(`Memory path does not match record identity: ${replacement.path}`);
    const recordValues = [
      record.id,
      record.organization_id,
      record.project_id,
      this.scope.scope,
      record.memory_type,
      record.record_type,
      record.topic,
      record.summary,
      record.details,
      record.created_at,
      record.created_by,
      JSON.stringify(record.supersedes),
      JSON.stringify(record.tags),
      searchableText(record),
      JSON.stringify(record),
    ];
    const recordInsert = replacement.exclusive
      ? `INSERT INTO memory_records
           (id, organization_id, project_id, scope, memory_type, record_type, topic, summary, details,
            created_at, created_by, supersedes, tags, search_text, document)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`
      : `INSERT INTO memory_records
           (id, organization_id, project_id, scope, memory_type, record_type, topic, summary, details,
            created_at, created_by, supersedes, tags, search_text, document)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
           organization_id = EXCLUDED.organization_id,
           project_id = EXCLUDED.project_id,
           memory_type = EXCLUDED.memory_type,
           record_type = EXCLUDED.record_type,
           topic = EXCLUDED.topic,
           summary = EXCLUDED.summary,
           details = EXCLUDED.details,
           created_at = EXCLUDED.created_at,
           created_by = EXCLUDED.created_by,
           supersedes = EXCLUDED.supersedes,
           tags = EXCLUDED.tags,
           search_text = EXCLUDED.search_text,
           document = EXCLUDED.document,
           scope = EXCLUDED.scope
         WHERE memory_records.organization_id = EXCLUDED.organization_id
           AND memory_records.project_id = EXCLUDED.project_id
           AND memory_records.scope = EXCLUDED.scope`;
    try {
      const result = await client.query(recordInsert, recordValues);
      if (!replacement.exclusive && result.rowCount === 0)
        throw new MemoryConflictError(`Memory ID belongs to another namespace: ${replacement.path}`);
    } catch (error: unknown) {
      if (replacement.exclusive && isUniqueViolation(error))
        throw new MemoryConflictError(`Memory path already exists: ${replacement.path}`);
      throw error;
    }
  }

  // -- search ---------------------------------------------------------------

  /** {@inheritdoc StorageBackend.search} */
  public async search(state: ShardState, query: string, options: BackendSearchOptions): Promise<MemoryRecord[]> {
    await this.ensureSchema();
    if (!query.trim()) return [];
    await this.checkOrRebuildCache(state);
    const byId = new Map(state.records.map((record) => [record.id, record]));
    const batchSize = Math.max(options.limit, 50);
    const results: MemoryRecord[] = [];
    let usedChars = 0;
    for (let offset = 0; results.length < options.limit; offset += batchSize) {
      const ranked = await this.rankQuery(query, batchSize, offset);
      if (!ranked.length) break;
      const remaining = options.limit - results.length;
      const page = collectSearchResults(ranked, byId, {
        ...options,
        limit: remaining,
        maxChars: options.maxChars - usedChars,
      });
      results.push(...page);
      usedChars += page.reduce((total, record) => total + JSON.stringify(record).length, 0);
      if (usedChars >= options.maxChars || ranked.length < batchSize) break;
      // A full database page can contain filtered-out rows, so continue
      // paging even when this page contributed fewer accepted records.
    }
    return results;
  }

  /**
   * Runs one ranked page. pg_textsearch ranks with the <@> operator, but the
   * operator alone ranks EVERY row under a seq scan — a tsquery WHERE clause
   * keeps the result set restricted to matching documents regardless of the
   * planner's index choice.
   */
  private async rankQuery(query: string, limit: number, offset: number): Promise<string[]> {
    const executor = this.currentClient() ?? this.pool;
    const shardClause = `organization_id = $1 AND project_id = $2 AND scope = $3`;
    const prefixQuery = postgresPrefixQuery(query);
    if (!prefixQuery) return [];
    const filter = `to_tsvector('english', search_text) @@ to_tsquery('english', $4)`;
    if (this.textSearchKind === 'pg_textsearch') {
      // <@> is an ORDER BY operator: pg_textsearch 1.5.0 has no bindable
      // query form (to_bm25query arrives in a later API), so the ranked
      // literal must be inlined. quoteLiteral emits a fully escaped E-string;
      // the matching filter is parameterized via a safe prefix tsquery.
      const ranked = PostgresBackend.quoteLiteral(query);
      const result = await executor.query(
        `SELECT id FROM memory_records
         WHERE ${shardClause} AND ${filter}
         ORDER BY search_text <@> ${ranked}
         LIMIT $5 OFFSET $6`,
        [this.scope.organizationId, this.scope.projectId, this.scope.scope, prefixQuery, limit, offset],
      );
      return result.rows.map((row) => row.id as string);
    }
    const result = await executor.query(
      `SELECT id FROM memory_records
       WHERE ${shardClause} AND ${filter}
       ORDER BY ts_rank(to_tsvector('english', search_text), to_tsquery('english', $4)) DESC, id ASC
       LIMIT $5 OFFSET $6`,
      [this.scope.organizationId, this.scope.projectId, this.scope.scope, prefixQuery, limit, offset],
    );
    return result.rows.map((row) => row.id as string);
  }

  // -- locking and cache ----------------------------------------------------

  /** {@inheritdoc StorageBackend.withLock} — advisory lock + snapshot. */
  public async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureSchema();
    // Re-entrant: nested calls reuse the bound transaction (same client,
    // same lock, one snapshot for the whole operation).
    if (this.txContext.getStore()) return operation();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [this.shardKey()]);
      const result = await this.txContext.run(client, () => operation());
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Escapes literal strings used inside pg_textsearch <@> queries. */
  private static quoteLiteral(value: string): string {
    return `E'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "''")}'`;
  }

  /** The bound transaction client inside withLock; undefined outside. */
  private currentClient(): pg.PoolClient | undefined {
    return this.txContext.getStore();
  }

  /** {@inheritdoc StorageBackend.checkOrRebuildCache} — the DB is the index. */
  public async checkOrRebuildCache(state: ShardState): Promise<CacheValidation> {
    await this.ensureSchema();
    const executor = this.currentClient() ?? this.pool;
    const result = await executor.query(
      `SELECT id, search_text FROM memory_records
       WHERE organization_id = $1 AND project_id = $2 AND scope = $3`,
      [this.scope.organizationId, this.scope.projectId, this.scope.scope],
    );
    const expected = new Map(state.records.map((record) => [record.id, searchableText(record)]));
    const mismatched = result.rows.filter((row) => expected.get(row.id as string) !== row.search_text);
    if (mismatched.length > 0) {
      const updater = this.currentClient() ?? this.pool;
      for (const row of mismatched) {
        const searchText = expected.get(row.id as string);
        if (searchText === undefined) continue;
        await updater.query(
          `UPDATE memory_records SET search_text = $1
           WHERE id = $2 AND organization_id = $3 AND project_id = $4 AND scope = $5`,
          [searchText, row.id, this.scope.organizationId, this.scope.projectId, this.scope.scope],
        );
      }
      return { outcome: 'rebuilt', evidence: 'canonical_snapshot_rebuild_verified' };
    }
    return { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' };
  }

  /** {@inheritdoc StorageBackend.resetCache} — a no-op for Postgres. */
  public async resetCache(): Promise<void> {
    this.schemaReady = false;
    // Nothing to delete: records are canonical here. Recreate the index on
    // the next operation through ensureSchema.
  }

  /** {@inheritdoc StorageBackend.close} */
  public async close(): Promise<void> {
    await this.pool.end();
  }

  // -- record helpers (shared semantics with the filesystem backend) --------

  public makeRecord(input: MemoryRecordInput, supersedes: string[], now: () => Date = () => new Date()): MemoryRecord {
    return makeRecordHelper(this.helperDeps, input, supersedes, now);
  }

  public makeTombstone(
    targetId: string,
    reason: string,
    source: MemoryTombstone['source'],
    createdBy: string,
    now: () => Date = () => new Date(),
  ): MemoryTombstone {
    return makeTombstoneHelper(this.helperDeps, targetId, reason, source, createdBy, now);
  }

  public validateCompactness(summary: string, details: string | null | undefined, context: string): void {
    validateCompactnessHelper(summary, details, context);
  }

  public validateRecord(value: unknown, label = 'memory record'): MemoryRecord {
    return validateRecordHelper(value, this.helperDeps, label);
  }

  public validateTombstone(value: unknown, label = 'memory tombstone'): MemoryTombstone {
    return validateTombstoneHelper(value, this.helperDeps, label);
  }

  /** Row identity: folder + ULID map onto the record/tombstone tables. */
  public recordPath(record: MemoryRecord): string {
    return `${RECORD_FOLDERS[record.record_type]}/${record.id}.yaml`;
  }

  public tombstonePath(tombstone: MemoryTombstone): string {
    return `tombstones/${tombstone.id}.yaml`;
  }

  public encode(value: MemoryRecord | MemoryTombstone): Uint8Array {
    return Buffer.from(stringify(value, { lineWidth: 0 }), 'utf8');
  }

  // -- internals ------------------------------------------------------------

  private shardKey(): string {
    return `${this.scope.organizationId}:${this.scope.projectId}:${this.scope.scope}`;
  }

  private parsePath(path: string): {
    table: 'memory_records' | 'memory_tombstones';
    id: string;
    recordType?: RecordType;
  } {
    const safe = safeProjectPath(path);
    if (safe.startsWith('tombstones/')) {
      const id = safe.slice('tombstones/'.length).replace(/\.yaml$/u, '');
      if (!isUlid(id)) throw new MemoryError(`Invalid tombstone path: ${path}`);
      return { table: 'memory_tombstones', id };
    }
    for (const [recordType, folder] of Object.entries(RECORD_FOLDERS) as Array<[RecordType, string]>) {
      if (safe.startsWith(`${folder}/`)) {
        const id = safe.slice(folder.length + 1).replace(/\.yaml$/u, '');
        if (!isUlid(id)) throw new MemoryError(`Invalid record path: ${path}`);
        return { table: 'memory_records', id, recordType };
      }
    }
    throw new MemoryError(`Memory path does not map to a Postgres table: ${path}`);
  }
}

// -- helpers ---------------------------------------------------------------

function parseDocumentBytes(bytes: Uint8Array, path: string): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new MemoryError(`Malformed UTF-8 memory YAML: ${path}`);
  }
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length || document.warnings.length)
    throw new MemoryError(
      `Malformed memory YAML ${path}: ${document.errors[0]?.message ?? document.warnings[0]?.message}`,
    );
  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch (error: unknown) {
    throw new MemoryError(`Unsafe memory YAML ${path}: ${describe(error)}`);
  }
}

function postgresPrefixQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/u)
    .map((term) => term.replace(/[^\p{L}\p{N}_]+/gu, ''))
    .filter(Boolean)
    .map((term) => `${term}:*`)
    .join(' & ');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505'
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
