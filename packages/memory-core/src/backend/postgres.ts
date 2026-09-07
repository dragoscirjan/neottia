import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { parseDocument, stringify } from 'yaml';
import type { MemoryConfig } from '../config.js';
import { MemoryError } from '../errors.js';
import { isUlid } from '../identities.js';
import type { MemoryRecord, MemoryTombstone } from '../schemas.js';
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
      ssl: settings.ssl ? { rejectUnauthorized: false } : false,
      user: settings.user,
      password: settings.password,
      max: 4,
    });
  }

  /** Escapes literal strings used inside pg_textsearch <@> queries. */
  private static quoteLiteral(value: string): string {
    return `'${value.replace(/'/gu, "''")}'`;
  }

  // -- schema ---------------------------------------------------------------

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
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
        target_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        document JSONB NOT NULL
      );
    `);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS memory_tombstones_target ON memory_tombstones (target_id);`);

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
    if (extension.rowCount === 0) {
      try {
        await this.pool.query(`CREATE EXTENSION IF NOT EXISTS pg_textsearch;`);
        await this.pool.query(
          `CREATE INDEX IF NOT EXISTS memory_records_bm25 ON memory_records USING bm25 (search_text) WITH (text_config = 'english');`,
        );
        this.textSearchKind = 'pg_textsearch';
      } catch {
        this.textSearchKind = 'tsvector';
      }
    } else {
      await this.pool.query(
        `CREATE INDEX IF NOT EXISTS memory_records_bm25 ON memory_records USING bm25 (search_text) WITH (text_config = 'english');`,
      );
      this.textSearchKind = 'pg_textsearch';
    }
    this.schemaReady = true;
  }

  // -- state ----------------------------------------------------------------

  /** {@inheritdoc StorageBackend.loadState} */
  public async loadState(): Promise<ShardState> {
    await this.ensureSchema();
    const executor = this.currentClient() ?? this.pool;
    const recordsResult = await executor.query(
      `SELECT document FROM memory_records WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [this.scope.organizationId, this.scope.projectId],
    );
    const tombstoneResult = await executor.query(`SELECT document FROM memory_tombstones ORDER BY created_at DESC`);

    const records = recordsResult.rows.map((row) => validateRecordHelper(row.document, this.helperDeps));
    const tombstones = tombstoneResult.rows.map((row) => validateTombstoneHelper(row.document, this.helperDeps));

    const recordIds = new Set(records.map((record) => record.id));
    for (const record of records)
      for (const target of record.supersedes)
        if (!recordIds.has(target)) throw new MemoryError(`Broken supersedes reference: ${target}`);
    for (const tombstone of tombstones)
      if (!recordIds.has(tombstone.target_id))
        throw new MemoryError(`Broken tombstone reference: ${tombstone.target_id}`);

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
      await client.query(`DELETE FROM ${parsed.table} WHERE id = $1`, [parsed.id]);
      return;
    }
    const document = parseDocumentBytes(replacement.bytes, replacement.path);
    if (parsed.table === 'memory_tombstones') {
      const tombstone = validateTombstoneHelper(document, this.helperDeps);
      if (replacement.exclusive)
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [this.shardKey(), tombstone.id]);
      await client.query(
        `INSERT INTO memory_tombstones (id, target_id, created_at, document)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET target_id = EXCLUDED.target_id, document = EXCLUDED.document`,
        [tombstone.id, tombstone.target_id, tombstone.created_at, JSON.stringify(tombstone)],
      );
      return;
    }
    const record = validateRecordHelper(document, this.helperDeps);
    if (replacement.exclusive) {
      const existing = await client.query(`SELECT 1 FROM memory_records WHERE id = $1`, [record.id]);
      if (existing.rowCount !== 0) throw new MemoryError(`Memory path already exists: ${replacement.path}`);
    }
    await client.query(
      `INSERT INTO memory_records
         (id, organization_id, project_id, memory_type, record_type, topic, summary, details,
          created_at, created_by, supersedes, tags, search_text, document)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET
         summary = EXCLUDED.summary,
         details = EXCLUDED.details,
         supersedes = EXCLUDED.supersedes,
         tags = EXCLUDED.tags,
         search_text = EXCLUDED.search_text,
         document = EXCLUDED.document`,
      [
        record.id,
        record.organization_id,
        record.project_id,
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
      ],
    );
  }

  // -- search ---------------------------------------------------------------

  /** {@inheritdoc StorageBackend.search} */
  public async search(state: ShardState, query: string, options: BackendSearchOptions): Promise<MemoryRecord[]> {
    await this.ensureSchema();
    if (!query.trim()) return [];
    const byId = new Map(state.records.map((record) => [record.id, record]));
    const batchSize = Math.max(options.limit, 50);
    const results: MemoryRecord[] = [];
    for (let offset = 0; results.length < options.limit; offset += batchSize) {
      const ranked = await this.rankQuery(query, batchSize, offset);
      if (!ranked.length) break;
      const page = collectSearchResults(ranked, byId, options);
      // The budget check inside the collector stops at page boundaries too.
      if (page.length === 0) break;
      results.push(...page);
      if (page.length < ranked.length) break;
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
    const shardClause = `organization_id = $1 AND project_id = $2`;
    const filter = `to_tsvector('english', search_text) @@ websearch_to_tsquery('english', $3)`;
    if (this.textSearchKind === 'pg_textsearch') {
      const result = await this.pool.query(
        `SELECT id FROM memory_records
         WHERE ${shardClause} AND ${filter}
         ORDER BY search_text <@> ${PostgresBackend.quoteLiteral(query)}
         LIMIT ${limit} OFFSET ${offset}`,
        [this.scope.organizationId, this.scope.projectId, query],
      );
      return result.rows.map((row) => row.id as string);
    }
    const result = await this.pool.query(
      `SELECT id FROM memory_records
       WHERE ${shardClause} AND ${filter}
       ORDER BY ts_rank(to_tsvector('english', search_text), websearch_to_tsquery('english', $3)) DESC, id ASC
       LIMIT ${limit} OFFSET ${offset}`,
      [this.scope.organizationId, this.scope.projectId, query],
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

  /** The bound transaction client inside withLock; undefined outside. */
  private currentClient(): pg.PoolClient | undefined {
    return this.txContext.getStore();
  }

  /** {@inheritdoc StorageBackend.checkOrRebuildCache} — the DB is the index. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- interface parameter; the database owns its index
  public async checkOrRebuildCache(_state: ShardState): Promise<CacheValidation> {
    await this.ensureSchema();
    // Data integrity check: the search column always mirrors the documents.
    const result = await this.pool.query(
      `SELECT count(*)::int AS mismatched FROM memory_records WHERE search_text = ''`,
    );
    if ((result.rows[0]?.mismatched ?? 0) > 0) {
      // Resync the search column from the stored documents.
      await this.pool.query(`
        UPDATE memory_records
        SET search_text = concat_ws(
          E'\\n',
          summary,
          coalesce(details, ''),
          topic,
          replace(tags::text, '"', '')
        )
        WHERE search_text = '';
      `);
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

  private parsePath(path: string): { table: 'memory_records' | 'memory_tombstones'; id: string } {
    const safe = safeProjectPath(path);
    if (safe.startsWith('tombstones/')) {
      const id = safe.slice('tombstones/'.length).replace(/\.yaml$/u, '');
      if (!isUlid(id)) throw new MemoryError(`Invalid tombstone path: ${path}`);
      return { table: 'memory_tombstones', id };
    }
    for (const folder of Object.values(RECORD_FOLDERS)) {
      if (safe.startsWith(`${folder}/`)) {
        const id = safe.slice(folder.length + 1).replace(/\.yaml$/u, '');
        if (!isUlid(id)) throw new MemoryError(`Invalid record path: ${path}`);
        return { table: 'memory_records', id };
      }
    }
    throw new MemoryError(`Memory path does not map to a Postgres table: ${path}`);
  }
}

// -- helpers ---------------------------------------------------------------

function parseDocumentBytes(bytes: Uint8Array, path: string): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length || document.warnings.length)
    throw new MemoryError(
      `Malformed memory YAML ${path}: ${document.errors[0]?.message ?? document.warnings[0]?.message}`,
    );
  return document.toJS();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
