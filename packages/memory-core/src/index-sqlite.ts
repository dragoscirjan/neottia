import {
  openDisposableSqliteCache,
  rebuildDisposableSqliteCache,
  removeDisposableSqliteCache,
  resolveManagedPath,
  type DisposableCacheSpecification,
  type DisposableSqliteCache,
  type ManagedRoot,
  type RepositoryLease,
} from '@neottia/repository-store';
import { collectSearchResults, searchableText } from './backend/record-helpers.js';
import type { BackendSearchOptions, ShardState } from './backend/types.js';
import type { MemoryRecord } from './schemas.js';

const MEMORY_CACHE_APPLICATION_ID = 0x4e4d454d;
const MEMORY_CACHE_SCHEMA_VERSION = 1;
const QUERY_RESULT_BYTES = 16 * 1024 * 1024;

/** Computes a deterministic hash of the canonical file inventory. */
export function canonicalHash(state: ShardState, filePaths?: readonly string[]): string {
  if (state.contentHash) return state.contentHash;
  // Retain the historical fallback for callers constructing ShardState values.
  const parts = [
    ...state.records.map((record) => `${record.id}:${record.created_at}`),
    ...state.tombstones.map((tombstone) => `t:${tombstone.id}`),
    ...(filePaths ?? []),
  ];
  let hash = 0x811c9dc5;
  for (const part of parts.sort()) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash = Math.imul(hash ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Creates the disposable projection contract for one canonical state. */
export function memoryCacheSpecification(root: ManagedRoot, state: ShardState): DisposableCacheSpecification {
  return {
    path: resolveManagedPath(root, 'index.db'),
    applicationId: MEMORY_CACHE_APPLICATION_ID,
    schemaVersion: MEMORY_CACHE_SCHEMA_VERSION,
    canonicalDigest: state.contentHash,
    schemaSql: [
      `CREATE TABLE memory_records (
        id TEXT PRIMARY KEY,
        memory_type TEXT NOT NULL,
        topic TEXT NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0, 1))
      );`,
      `CREATE VIRTUAL TABLE memory_search USING fts5(
        id UNINDEXED,
        text,
        tokenize = 'porter unicode61'
      );`,
    ],
    async populate(database) {
      const recordInsert = await database.prepare(
        'INSERT INTO memory_records (id, memory_type, topic, active) VALUES (?, ?, ?, ?)',
      );
      const searchInsert = await database.prepare('INSERT INTO memory_search (id, text) VALUES (?, ?)');
      for (const record of [...state.records].sort((left, right) => left.id.localeCompare(right.id))) {
        await recordInsert.run([record.id, record.memory_type, record.topic, state.activeIds.has(record.id) ? 1 : 0]);
        await searchInsert.run([record.id, searchableText(record)]);
      }
    },
    async healthCheck(database) {
      const expected = [...state.records].sort((left, right) => left.id.localeCompare(right.id));
      const recordCount = await (
        await database.prepare('SELECT count(*) AS count FROM memory_records')
      ).get<{ count: number }>();
      const searchCount = await (
        await database.prepare('SELECT count(*) AS count FROM memory_search')
      ).get<{ count: number }>();
      if (recordCount?.count !== expected.length || searchCount?.count !== expected.length)
        throw new Error('Memory cache projection row count differs from canonical state.');

      // Verify one bounded row per canonical ID. The two exact counts above
      // prove that no unvisited projection row can exist.
      const byId = await database.prepare(
        `SELECT r.id, r.memory_type, r.topic, r.active, s.text
         FROM memory_records r JOIN memory_search s ON s.id = r.id
         WHERE r.id = ?`,
      );
      for (const record of expected) {
        const row = await byId.get<{
          id: string;
          memory_type: string;
          topic: string;
          active: number;
          text: string;
        }>([record.id]);
        if (
          row?.id !== record.id ||
          row.memory_type !== record.memory_type ||
          row.topic !== record.topic ||
          row.active !== (state.activeIds.has(record.id) ? 1 : 0) ||
          row.text !== searchableText(record)
        )
          throw new Error(`Memory cache projection contradicts canonical record: ${record.id}`);
      }
    },
  };
}

/** Opens a healthy cache, returning undefined when rebuilding is required. */
export async function openMemoryCache(
  root: ManagedRoot,
  lease: RepositoryLease,
  state: ShardState,
  maxAgeMs: number,
): Promise<DisposableSqliteCache | undefined> {
  const opened = await openDisposableSqliteCache(root, lease, memoryCacheSpecification(root, state));
  if (opened.state !== 'ready') return undefined;
  let fresh = false;
  try {
    const rebuilt = await (
      await opened.database.prepare("SELECT value FROM neottia_repository_cache_meta WHERE key='rebuilt_at'")
    ).get<{ value: string }>();
    const rebuiltAt = Date.parse(rebuilt?.value ?? '');
    // A zero freshness window means "always stale", including a rebuild and
    // freshness check that happen during the same clock millisecond.
    fresh = maxAgeMs > 0 && Number.isFinite(rebuiltAt) && Date.now() - rebuiltAt <= maxAgeMs;
  } finally {
    // The caller cannot close a handle that fails validation before return.
    if (!fresh) await opened.close();
  }
  return fresh ? opened : undefined;
}

/** Rebuilds the disposable projection from canonical records. */
export function rebuildMemoryCache(
  root: ManagedRoot,
  lease: RepositoryLease,
  state: ShardState,
): Promise<DisposableSqliteCache> {
  return rebuildDisposableSqliteCache(root, lease, memoryCacheSpecification(root, state));
}

/** Searches candidate IDs and hydrates every result from canonical state. */
export async function searchMemoryCache(
  cache: DisposableSqliteCache,
  query: string,
  state: ShardState,
  options: BackendSearchOptions,
): Promise<MemoryRecord[]> {
  const match = termsOf(query);
  if (match === undefined) return [];
  const clauses = ['memory_search MATCH ?'];
  const parameters: Array<string | number> = [match];
  if (!(options.includeSuperseded ?? false)) clauses.push('r.active = 1');
  if (options.topic !== undefined) {
    clauses.push('r.topic = ?');
    parameters.push(options.topic);
  }
  if (options.memoryType !== undefined) {
    clauses.push('r.memory_type = ?');
    parameters.push(options.memoryType);
  }
  parameters.push(options.limit);
  const ranked = await (
    await cache.database.prepare(
      `SELECT r.id, bm25(memory_search) AS rank
       FROM memory_search JOIN memory_records r ON r.id = memory_search.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY rank ASC, r.id ASC
       LIMIT ?`,
    )
  ).all<{ id: string; rank: number }>(parameters, {
    maxRows: options.limit,
    maxBytes: QUERY_RESULT_BYTES,
  });
  return collectSearchResults(
    ranked.map((row) => row.id),
    new Map(state.records.map((record) => [record.id, record])),
    options,
  );
}

/** Removes exact DB/WAL/SHM projection artifacts. */
export function removeMemoryCache(root: ManagedRoot, lease: RepositoryLease): Promise<void> {
  return removeDisposableSqliteCache(root, lease, resolveManagedPath(root, 'index.db'));
}

/** FTS5 prefix-phrase query: every whitespace term is required. */
function termsOf(query: string): string | undefined {
  const terms = query
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((term) => term.replace(/"/gu, '""'));
  return terms.length === 0 ? undefined : terms.map((term) => `"${term}"*`).join(' AND ');
}
