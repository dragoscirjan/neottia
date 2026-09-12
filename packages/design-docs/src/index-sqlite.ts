import { createHash } from 'node:crypto';
import {
  openDisposableSqliteCache,
  rebuildDisposableSqliteCache,
  resolveManagedPath,
  type DisposableCacheSpecification,
  type DisposableSqliteCache,
  type ManagedRoot,
  type OperationControl,
  type RepositoryLease,
  RepositoryStoreError,
  type SqliteConnection,
  type SqliteValue,
} from '@neottia/repository-store';
import { entitySummary, type DocumentCatalog } from './catalog.js';
import type { DesignDocsConfig } from './config.js';
import { DesignDocsError } from './errors.js';
import type { DocumentKind, DocumentLocation, DocumentSearchHit, DocumentStatus } from './schemas.js';

const APPLICATION_ID = 0x4e444f43; // "NDOC"
const SCHEMA_VERSION = 1;

export interface SearchDocumentsInput {
  readonly query: string;
  readonly kind?: DocumentKind;
  readonly status?: DocumentStatus;
  readonly location?: DocumentLocation;
  readonly id?: string;
  readonly all_versions?: boolean;
  readonly limit?: number;
}

export function canonicalCatalogDigest(catalog: DocumentCatalog): string {
  const hash = createHash('sha256');
  for (const entity of catalog.entities)
    hash.update(entity.storagePath).update('\0').update(entity.decoded.revision).update('\n');
  return hash.digest('hex');
}

/** Opens a verified projection, rebuilding only from the already-valid catalog. */
export async function ensureDesignDocsCache(
  cacheRoot: ManagedRoot,
  lease: RepositoryLease,
  catalog: DocumentCatalog,
  config: DesignDocsConfig,
  onStale: (() => boolean | Promise<boolean>) | undefined,
  control: OperationControl = {},
): Promise<{ cache: DisposableSqliteCache; rebuilt: boolean }> {
  const specification = cacheSpecification(cacheRoot, catalog, config);
  const opened = await openDisposableSqliteCache(cacheRoot, lease, specification, control);
  if (opened.state === 'ready') {
    let row: { value: SqliteValue } | undefined;
    try {
      const rebuiltAt = await opened.database.prepare(
        "SELECT value FROM neottia_repository_cache_meta WHERE key='rebuilt_at'",
      );
      row = await rebuiltAt.get<{ value: SqliteValue }>();
    } catch (error: unknown) {
      // Preserve the probe failure while preventing one leaked handle per retry.
      try {
        await opened.close();
      } catch {
        // The original probe failure remains the actionable cache diagnosis.
      }
      throw error;
    }
    const rebuiltTime =
      typeof row?.value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(row.value)
        ? Date.parse(row.value)
        : Number.NaN;
    const age = Date.now() - rebuiltTime;
    const stale = !Number.isFinite(rebuiltTime) || age < -300_000 || age > config.cache.max_age_ms;
    if (!stale) return { cache: opened, rebuilt: false };
    await opened.close();
    if (config.cache.stale_policy === 'fail')
      throw new DesignDocsError('cache', 'CACHE_STALE', 'Design Docs search cache is stale.');
    if (config.cache.stale_policy === 'prompt' && onStale && !(await onStale()))
      throw new DesignDocsError('cache', 'CACHE_STALE_DECLINED', 'Design Docs cache rebuild was declined.');
  } else {
    if (config.cache.stale_policy === 'fail')
      throw new DesignDocsError(
        'cache',
        'CACHE_REBUILD_REQUIRED',
        `Design Docs cache requires rebuild: ${opened.reason}.`,
      );
    if (opened.reason === 'stale-digest' && config.cache.stale_policy === 'prompt' && onStale && !(await onStale()))
      throw new DesignDocsError('cache', 'CACHE_STALE_DECLINED', 'Design Docs cache rebuild was declined.');
  }
  return { cache: await rebuildDisposableSqliteCache(cacheRoot, lease, specification, control), rebuilt: true };
}

/** Runs BM25, then hydrates every hit from the same canonical snapshot. */
export async function searchDesignDocsCache(
  database: SqliteConnection,
  catalog: DocumentCatalog,
  input: SearchDocumentsInput,
  config: DesignDocsConfig,
): Promise<DocumentSearchHit[]> {
  if (Buffer.byteLength(input.query, 'utf8') > config.security.limits.max_query_bytes)
    throw new DesignDocsError('resource_limit', 'QUERY_LIMIT', 'Search query byte limit exceeded.');
  const limit = Math.min(input.limit ?? config.retrieval.limit, config.security.limits.max_results);
  const clauses = ['documents_fts MATCH ?'];
  const parameters: SqliteValue[] = [input.query];
  if (input.kind) {
    clauses.push('records.kind = ?');
    parameters.push(input.kind);
  }
  if (input.status) {
    clauses.push('records.status = ?');
    parameters.push(input.status);
  }
  if (input.location) {
    clauses.push('records.location = ?');
    parameters.push(input.location);
  }
  if (input.id) {
    clauses.push('records.id = ?');
    parameters.push(input.id);
  }
  if (!(input.all_versions ?? config.retrieval.all_versions)) clauses.push('records.current_version = 1');
  parameters.push(limit);
  const statement = await database.prepare(`
    SELECT records.id AS id, records.version AS version, bm25(documents_fts) AS rank
    FROM documents_fts JOIN records ON records.row_key = documents_fts.rowid
    WHERE ${clauses.join(' AND ')}
    ORDER BY rank ASC, records.version DESC, records.id ASC
    LIMIT ?`);
  let rows: readonly { id: SqliteValue; version: SqliteValue; rank: SqliteValue }[];
  try {
    rows = await statement.all(parameters, { maxRows: limit, maxBytes: config.security.limits.max_result_bytes });
  } catch (error: unknown) {
    if (error instanceof DesignDocsError || error instanceof RepositoryStoreError) throw error;
    throw new DesignDocsError(
      'schema',
      'SEARCH_QUERY_INVALID',
      'Search query is not valid FTS5 syntax.',
      [],
      undefined,
      { cause: error },
    );
  }
  const results = rows.map((row) => {
    const id = String(row.id);
    const version = Number(row.version);
    const lineage = catalog.byId.get(id);
    const entity = lineage?.find((candidate) => candidate.decoded.metadata.version === version);
    if (!entity || !lineage)
      throw new DesignDocsError('cache', 'CACHE_CONTRADICTION', 'Search cache returned a non-canonical record.');
    return {
      ...entitySummary(entity, lineage),
      score: -Number(row.rank),
      snippet: truncateUtf8(entity.decoded.content.replace(/\s+/gu, ' ').trim(), config.retrieval.snippet_bytes),
    };
  });
  if (Buffer.byteLength(JSON.stringify(results), 'utf8') > config.security.limits.max_result_bytes)
    throw new DesignDocsError(
      'resource_limit',
      'SEARCH_RESULT_LIMIT',
      'Hydrated search results exceed the configured UTF-8 byte limit.',
    );
  return results;
}

function cacheSpecification(
  root: ManagedRoot,
  catalog: DocumentCatalog,
  config: DesignDocsConfig,
): DisposableCacheSpecification {
  return {
    path: resolveManagedPath(root, 'design-docs.sqlite'),
    applicationId: APPLICATION_ID,
    schemaVersion: SCHEMA_VERSION,
    canonicalDigest: canonicalCatalogDigest(catalog),
    schemaSql: [
      'CREATE TABLE records (row_key INTEGER PRIMARY KEY, id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, location TEXT NOT NULL, revision TEXT NOT NULL, current_version INTEGER NOT NULL, UNIQUE(id, version));',
      "CREATE VIRTUAL TABLE documents_fts USING fts5(id UNINDEXED, version UNINDEXED, title, body, metadata, tokenize='unicode61');",
    ],
    async populate(database) {
      const record = await database.prepare(
        'INSERT INTO records (row_key,id,version,kind,status,location,revision,current_version) VALUES (?,?,?,?,?,?,?,?)',
      );
      const fulltext = await database.prepare(
        'INSERT INTO documents_fts (rowid,id,version,title,body,metadata) VALUES (?,?,?,?,?,?)',
      );
      for (const [index, entity] of catalog.entities.entries()) {
        const metadata = entity.decoded.metadata;
        const current = catalog.byId.get(metadata.id)?.at(-1)?.decoded.metadata.version === metadata.version ? 1 : 0;
        const row = index + 1;
        await record.run([
          row,
          metadata.id,
          metadata.version,
          metadata.kind,
          metadata.status,
          entity.location,
          entity.decoded.revision,
          current,
        ]);
        await fulltext.run([
          row,
          metadata.id,
          metadata.version,
          metadata.title,
          entity.decoded.content,
          JSON.stringify(metadata.metadata ?? {}),
        ]);
      }
    },
    async healthCheck(database) {
      // Read one complete FTS row at a time so several individually valid large
      // documents cannot exceed the per-query byte budget during verification.
      const pageSize = 1;
      const sql =
        await database.prepare(`SELECT records.row_key AS row_key, records.id AS id, records.version AS version,
        records.kind AS kind, records.status AS status, records.location AS location, records.revision AS revision,
        records.current_version AS current_version, documents_fts.title AS title, documents_fts.body AS body,
        documents_fts.metadata AS metadata
        FROM records JOIN documents_fts ON records.row_key = documents_fts.rowid ORDER BY records.row_key LIMIT ? OFFSET ?`);
      let checked = 0;
      while (checked < catalog.entities.length) {
        const rows = await sql.all<Record<string, SqliteValue>>([pageSize, checked], {
          maxRows: pageSize,
          maxBytes: config.security.limits.max_result_bytes,
        });
        if (rows.length === 0) throw new Error('Cache row count contradicts canonical snapshot.');
        for (const [pageIndex, row] of rows.entries()) {
          const index = checked + pageIndex;
          const entity = catalog.entities[index];
          if (!entity) throw new Error('Cache contains records absent from canonical authority.');
          const metadata = entity.decoded.metadata;
          const current = catalog.byId.get(metadata.id)?.at(-1)?.decoded.metadata.version === metadata.version ? 1 : 0;
          const expected: Record<string, SqliteValue> = {
            row_key: index + 1,
            id: metadata.id,
            version: metadata.version,
            kind: metadata.kind,
            status: metadata.status,
            location: entity.location,
            revision: entity.decoded.revision,
            current_version: current,
            title: metadata.title,
            body: entity.decoded.content,
            metadata: JSON.stringify(metadata.metadata ?? {}),
          };
          if (Object.entries(expected).some(([key, value]) => row[key] !== value))
            throw new Error('Cache record contradicts canonical snapshot.');
        }
        checked += rows.length;
      }
      const extra = await sql.all<Record<string, SqliteValue>>([1, checked], {
        maxRows: 1,
        maxBytes: config.security.limits.max_result_bytes,
      });
      if (extra.length) throw new Error('Cache contains extra records.');
    },
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result + character, 'utf8') > maxBytes) break;
    result += character;
  }
  return result;
}
