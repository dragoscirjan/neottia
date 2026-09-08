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

/** Maps already-resolved config to pg settings without expanding credentials again. */
export function resolvePgSettings(config: MemoryConfig): PgConnectionSettings {
  const settings = config.provider.db.pg;
  return {
    host: settings.host,
    port: settings.port,
    database: settings.database,
    ssl: settings.ssl,
    user: settings.user,
    password: settings.password,
  };
}

export class PostgresBackend implements StorageBackend {
  private readonly pool: pg.Pool;
  private readonly scope: NamespaceScope;
  private readonly helperDeps: RecordHelperDeps;
  private readonly scanner: SecretScanner;
  private readonly limits: { maxFileBytes: number; maxFiles: number; maxTotalBytes: number };
  private textSearchKind: 'pg_textsearch' | 'tsvector' = 'tsvector';
  private schemaInitialization?: Promise<void>;
  /** Client bound to the active withLock transaction, if any. */
  private readonly txContext = new AsyncLocalStorage<pg.PoolClient>();

  public constructor(options: PostgresBackendOptions) {
    const settings = resolvePgSettings(options.config);
    this.scope = {
      organizationId: options.config.namespace.organization_id,
      projectId: options.config.namespace.project_id,
      scope: options.config.namespace.scope,
    };
    this.limits = {
      maxFileBytes: options.config.security.limits.max_file_bytes,
      maxFiles: options.config.security.limits.max_files,
      maxTotalBytes: options.config.security.limits.max_total_bytes,
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
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 15_000,
    });
  }

  // -- schema ---------------------------------------------------------------

  private async ensureSchema(): Promise<void> {
    this.schemaInitialization ??= this.initializeSchema().catch((error: unknown) => {
      this.schemaInitialization = undefined;
      throw asPostgresMemoryError(error, 'initialize the PostgreSQL memory schema');
    });
    await this.schemaInitialization;
  }

  /** Migrates canonical tables under a global transaction-scoped lock. */
  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '10s'`);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('neottia-memory-schema-v2'))`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS memory_records (
          id TEXT NOT NULL,
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
          document JSONB NOT NULL,
          search_text TEXT NOT NULL DEFAULT '',
          storage_bytes BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (organization_id, project_id, scope, id)
        );
        CREATE TABLE IF NOT EXISTS memory_tombstones (
          id TEXT NOT NULL,
          organization_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'global',
          target_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          document JSONB NOT NULL,
          storage_bytes BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (organization_id, project_id, scope, id)
        );
      `);
      // Legacy rows lacked scope and had a globally unique id. Defaults retain
      // those rows in global while the replacement key permits shard reuse.
      await client.query(`
        ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global';
        ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';
        ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS storage_bytes BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE memory_tombstones ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global';
        ALTER TABLE memory_tombstones ADD COLUMN IF NOT EXISTS storage_bytes BIGINT NOT NULL DEFAULT 0;
        UPDATE memory_records SET storage_bytes = octet_length(document::text) WHERE storage_bytes = 0;
        UPDATE memory_tombstones SET storage_bytes = octet_length(document::text) WHERE storage_bytes = 0;
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'memory_records'::regclass AND contype = 'p'
              AND pg_get_constraintdef(oid) = 'PRIMARY KEY (organization_id, project_id, scope, id)'
          ) THEN
            ALTER TABLE memory_records DROP CONSTRAINT IF EXISTS memory_records_pkey;
            ALTER TABLE memory_records ADD CONSTRAINT memory_records_pkey
              PRIMARY KEY (organization_id, project_id, scope, id);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'memory_tombstones'::regclass AND contype = 'p'
              AND pg_get_constraintdef(oid) = 'PRIMARY KEY (organization_id, project_id, scope, id)'
          ) THEN
            ALTER TABLE memory_tombstones DROP CONSTRAINT IF EXISTS memory_tombstones_pkey;
            ALTER TABLE memory_tombstones ADD CONSTRAINT memory_tombstones_pkey
              PRIMARY KEY (organization_id, project_id, scope, id);
          END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS memory_tombstones_shard_target
          ON memory_tombstones (organization_id, project_id, scope, target_id);
        CREATE INDEX IF NOT EXISTS memory_records_shard
          ON memory_records (organization_id, project_id, scope, created_at DESC);
        CREATE INDEX IF NOT EXISTS memory_tombstones_shard
          ON memory_tombstones (organization_id, project_id, scope);
        CREATE INDEX IF NOT EXISTS memory_records_tsvector
          ON memory_records USING gin (to_tsvector('english', search_text));
      `);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    // Every pg_textsearch-specific operation is optional. Only select it
    // after discovery, install, index creation, and a real operator query.
    try {
      const extension = await this.pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_textsearch'`);
      if (extension.rowCount === 0) await this.pool.query(`CREATE EXTENSION IF NOT EXISTS pg_textsearch`);
      await this.pool.query(
        `CREATE INDEX IF NOT EXISTS memory_records_bm25 ON memory_records USING bm25 (search_text) WITH (text_config = 'english')`,
      );
      await this.pool.query(
        `SELECT search_text <@> E'neottia probe' FROM (VALUES ('neottia probe')) probe(search_text)`,
      );
      this.textSearchKind = 'pg_textsearch';
    } catch {
      this.textSearchKind = 'tsvector';
    }
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
    if (!bound) {
      await this.withLock(() => this.applyBatch(replacements));
      return;
    }
    // Calculate the resulting shard inventory before the first mutation, so
    // every limit rejection leaves canonical rows unchanged.
    await this.assertBatchWithinLimits(bound, replacements);
    for (const replacement of replacements) await this.applyReplacement(bound, replacement);
  }

  /** Validates per-item and resulting aggregate storage limits. */
  private async assertBatchWithinLimits(
    client: pg.PoolClient,
    replacements: readonly StorageReplacement[],
  ): Promise<void> {
    const result = await client.query(
      `SELECT 'memory_records' AS table_name, id, storage_bytes FROM memory_records
       WHERE organization_id = $1 AND project_id = $2 AND scope = $3
       UNION ALL
       SELECT 'memory_tombstones' AS table_name, id, storage_bytes FROM memory_tombstones
       WHERE organization_id = $1 AND project_id = $2 AND scope = $3`,
      [this.scope.organizationId, this.scope.projectId, this.scope.scope],
    );
    const inventory = new Map<string, number>(
      result.rows.map((row) => [`${String(row.table_name)}:${String(row.id)}`, Number(row.storage_bytes)]),
    );
    for (const replacement of replacements) {
      const parsed = this.parsePath(replacement.path);
      const key = `${parsed.table}:${parsed.id}`;
      if (replacement.bytes === undefined) {
        inventory.delete(key);
        continue;
      }
      if (replacement.bytes.byteLength > this.limits.maxFileBytes)
        throw new MemoryError(
          `PostgreSQL memory item '${replacement.path}' is ${replacement.bytes.byteLength} bytes; max_file_bytes is ${this.limits.maxFileBytes}.`,
        );
      inventory.set(key, replacement.bytes.byteLength);
    }
    if (inventory.size > this.limits.maxFiles)
      throw new MemoryError(
        `PostgreSQL memory shard would contain ${inventory.size} items; max_files is ${this.limits.maxFiles}.`,
      );
    const totalBytes = [...inventory.values()].reduce((total, bytes) => total + bytes, 0);
    if (totalBytes > this.limits.maxTotalBytes)
      throw new MemoryError(
        `PostgreSQL memory shard would contain ${totalBytes} bytes; max_total_bytes is ${this.limits.maxTotalBytes}.`,
      );
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
        replacement.bytes.byteLength,
      ];
      const tombstoneInsert = replacement.exclusive
        ? `INSERT INTO memory_tombstones
             (id, organization_id, project_id, scope, target_id, created_at, document, storage_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
        : `INSERT INTO memory_tombstones
             (id, organization_id, project_id, scope, target_id, created_at, document, storage_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (organization_id, project_id, scope, id) DO UPDATE SET
             target_id = EXCLUDED.target_id,
             created_at = EXCLUDED.created_at,
             document = EXCLUDED.document,
             storage_bytes = EXCLUDED.storage_bytes`;
      try {
        await client.query(tombstoneInsert, tombstoneValues);
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
      replacement.bytes.byteLength,
    ];
    const recordInsert = replacement.exclusive
      ? `INSERT INTO memory_records
           (id, organization_id, project_id, scope, memory_type, record_type, topic, summary, details,
            created_at, created_by, supersedes, tags, search_text, document, storage_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`
      : `INSERT INTO memory_records
           (id, organization_id, project_id, scope, memory_type, record_type, topic, summary, details,
            created_at, created_by, supersedes, tags, search_text, document, storage_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (organization_id, project_id, scope, id) DO UPDATE SET
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
           scope = EXCLUDED.scope,
           storage_bytes = EXCLUDED.storage_bytes`;
    try {
      await client.query(recordInsert, recordValues);
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
    // Re-entrant calls share the same transaction, lock, and snapshot.
    if (this.txContext.getStore()) return operation();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let client: pg.PoolClient | undefined;
      try {
        client = await this.pool.connect();
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = '10s'`);
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [this.shardKey()]);
        const result = await this.txContext.run(client, () => operation());
        await client.query('COMMIT');
        return result;
      } catch (error: unknown) {
        if (client) await client.query('ROLLBACK').catch(() => undefined);
        if (attempt === 0 && isRetryableTransactionError(error)) continue;
        throw asPostgresMemoryError(error, `access PostgreSQL memory shard '${this.shardKey()}'`);
      } finally {
        client?.release();
      }
    }
    throw new MemoryError(`Unable to access PostgreSQL memory shard '${this.shardKey()}'.`);
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
      const ids: string[] = [];
      const searchTexts: string[] = [];
      for (const row of mismatched) {
        const searchText = expected.get(row.id as string);
        if (searchText === undefined) continue;
        ids.push(row.id as string);
        searchTexts.push(searchText);
      }
      if (ids.length > 0)
        await updater.query(
          `UPDATE memory_records AS records SET search_text = updates.search_text
           FROM unnest($1::text[], $2::text[]) AS updates(id, search_text)
           WHERE records.id = updates.id
             AND records.organization_id = $3 AND records.project_id = $4 AND records.scope = $5`,
          [ids, searchTexts, this.scope.organizationId, this.scope.projectId, this.scope.scope],
        );
      return { outcome: 'rebuilt', evidence: 'canonical_snapshot_rebuild_verified' };
    }
    return { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' };
  }

  /** {@inheritdoc StorageBackend.resetCache} — a no-op for Postgres. */
  public async resetCache(): Promise<void> {
    this.schemaInitialization = undefined;
    // Nothing to delete: records are canonical here. Recheck the index on
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
      if (!isUlid(id) || safe !== `tombstones/${id}.yaml`) throw new MemoryError(`Invalid tombstone path: ${path}`);
      return { table: 'memory_tombstones', id };
    }
    for (const [recordType, folder] of Object.entries(RECORD_FOLDERS) as Array<[RecordType, string]>) {
      if (safe.startsWith(`${folder}/`)) {
        const id = safe.slice(folder.length + 1).replace(/\.yaml$/u, '');
        if (!isUlid(id) || safe !== `${folder}/${id}.yaml`) throw new MemoryError(`Invalid record path: ${path}`);
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
  return postgresErrorCode(error) === '23505';
}

/** Retries only serialization failures and deadlocks, once. */
function isRetryableTransactionError(error: unknown): boolean {
  return ['40001', '40P01'].includes(postgresErrorCode(error) ?? '');
}

function postgresErrorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/** Converts bounded wait failures into actionable public errors. */
function asPostgresMemoryError(error: unknown, action: string): MemoryError {
  if (error instanceof MemoryError) return error;
  const code = postgresErrorCode(error);
  if (code === '57014')
    return new MemoryError(
      `Timed out after 10 seconds while attempting to ${action}; check for a long-running query or a process holding the shard advisory lock.`,
    );
  if (code === '55P03')
    return new MemoryError(
      `Could not acquire a PostgreSQL lock while attempting to ${action}; retry after the lock holder exits.`,
    );
  if (code === '53300')
    return new MemoryError(
      `PostgreSQL has no connection slots available while attempting to ${action}; check pool capacity.`,
    );
  const message = describe(error);
  if (/timeout|ECONNREFUSED|ENOTFOUND|connection terminated/iu.test(message))
    return new MemoryError(
      `PostgreSQL connection failed within the 5 second wait while attempting to ${action}; verify host, port, database, credentials, and server availability. (${message})`,
    );
  return new MemoryError(`Unable to ${action}: ${message}`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
