import { existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { collectSearchResults, searchableText } from './backend/record-helpers.js';

/** FTS5 prefix-phrase query: every term must match, terms match by prefix. */
function termsOf(query: string): string | undefined {
  const terms = query
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((term) => term.replace(/"/gu, '""'));
  if (!terms.length) return undefined;
  return terms.map((term) => `"${term}"*`).join(' AND ');
}
import type { ShardState } from './backend/types.js';
import { MemoryError } from './errors.js';
import type { MemoryRecord } from './schemas.js';
/**
 * SQLite index over the canonical YAML records (neottia#1 decision: the
 * database is a cache, the filesystem stays canonical). Uses node:sqlite
 * (built into Node 22.13+) with FTS5 for BM25-ranked search, WAL mode, and a
 * replace-all sync inside one transaction — the whole index is disposable
 * and rebuildable from canonical state at any time.
 */

export type StalePolicy = 'prompt' | 'rebuild' | 'fail';

export interface IndexSyncReport {
  outcome: 'checked' | 'rebuilt';
  canonicalHash: string;
  previousHash?: string;
}

export interface IndexSearchFilters {
  topic?: string;
  memoryType?: string;
  includeSuperseded?: boolean;
  activeIds: ReadonlySet<string>;
}

export interface IndexSearchOptions extends IndexSearchFilters {
  limit: number;
  maxChars: number;
}

/** Computes a deterministic hash of the canonical file inventory. */
export function canonicalHash(state: ShardState, filePaths?: readonly string[]): string {
  if (state.contentHash) return state.contentHash;
  // Fallback (state built without file digests): FNV-1a over identities.
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

export class SqliteIndex {
  private readonly database: DatabaseSync;
  private readonly dbPath: string;

  private constructor(database: DatabaseSync, dbPath: string) {
    this.database = database;
    this.dbPath = dbPath;
  }

  /** Filesystem location of the index database. */
  public get path(): string {
    return this.dbPath;
  }

  /** Opens (creating if needed) the index database inside the memory root. */
  public static open(memoryRoot: string, fileName = 'index.db'): SqliteIndex {
    assertSafeCacheFileName(fileName);
    const dbPath = join(memoryRoot, fileName);
    assertCacheArtifactsAreRegular(dbPath);
    let retried = false;
    for (;;) {
      try {
        mkdirSync(memoryRoot, { recursive: true, mode: 0o700 });
        const database = new DatabaseSync(dbPath);
        try {
          database.exec('PRAGMA journal_mode = WAL;');
          database.exec('PRAGMA synchronous = NORMAL;');
          database.exec(`
            CREATE TABLE IF NOT EXISTS memory_records (
              id TEXT PRIMARY KEY,
              organization_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              memory_type TEXT NOT NULL,
              record_type TEXT NOT NULL,
              topic TEXT NOT NULL,
              summary TEXT NOT NULL,
              details TEXT,
              source_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              created_by TEXT NOT NULL,
              confidence TEXT NOT NULL,
              supersedes_json TEXT NOT NULL,
              tags_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS memory_records_active
              ON memory_records (organization_id, project_id, created_at DESC);
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(
              id UNINDEXED,
              text,
              tokenize = 'porter unicode61'
            );
            CREATE TABLE IF NOT EXISTS memory_tombstones (
              id TEXT PRIMARY KEY,
              target_id TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS memory_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
          `);
          return new SqliteIndex(database, dbPath);
        } catch (error: unknown) {
          // The index is a disposable cache: corrupt or incompatible bytes
          // are removed and rebuilt from canonical state on the next sync.
          database.close();
          if (!retried && existsSync(dbPath)) {
            retried = true;
            for (const suffix of ['', '-wal', '-shm']) {
              const stalePath = `${dbPath}${suffix}`;
              if (existsSync(stalePath)) rmSync(stalePath);
            }
            continue;
          }
          throw new MemoryError(`Cannot open memory index at ${dbPath}: ${describe(error)}`);
        }
      } catch (error: unknown) {
        if (error instanceof MemoryError) throw error;
        throw new MemoryError(`Cannot open memory index at ${dbPath}: ${describe(error)}`);
      }
    }
  }

  /** Reads the stored canonical hash and rebuild timestamp, if any. */
  public meta(): { canonicalHash?: string; rebuiltAt?: string } {
    const rows = this.database
      .prepare(`SELECT key, value FROM memory_meta WHERE key IN ('canonical_hash','rebuilt_at')`)
      .all() as Array<{
      key: string;
      value: string;
    }>;
    const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return { canonicalHash: map.canonical_hash, rebuiltAt: map.rebuilt_at };
  }

  /** True when the index is missing, older than maxAgeMs, or hash-diverged. */
  public isStale(maxAgeMs: number, state: ShardState, filePaths?: readonly string[]): boolean {
    const { canonicalHash: stored, rebuiltAt } = this.meta();
    if (stored === undefined || rebuiltAt === undefined) return true;
    const rebuiltAtMs = Date.parse(rebuiltAt);
    if (!Number.isFinite(rebuiltAtMs) || Date.now() - rebuiltAtMs > maxAgeMs) return true;
    return stored !== canonicalHash(state, filePaths);
  }

  /** Replaces the whole index contents inside one transaction. */
  public rebuild(state: ShardState): void {
    const hash = canonicalHash(state);
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.exec('DELETE FROM memory_search;');
      this.database.exec('DELETE FROM memory_records;');
      this.database.exec('DELETE FROM memory_tombstones;');
      const insertRecord = this.database.prepare(`
        INSERT INTO memory_records
          (id, organization_id, project_id, memory_type, record_type, topic, summary, details,
           source_json, created_at, created_by, confidence, supersedes_json, tags_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertSearch = this.database.prepare('INSERT INTO memory_search (id, text) VALUES (?, ?)');
      for (const record of state.records) {
        insertRecord.run(
          record.id,
          record.organization_id,
          record.project_id,
          record.memory_type,
          record.record_type,
          record.topic,
          record.summary,
          record.details,
          JSON.stringify(record.source),
          record.created_at,
          record.created_by,
          record.confidence,
          JSON.stringify(record.supersedes),
          JSON.stringify(record.tags),
        );
        insertSearch.run(record.id, searchableText(record));
      }
      const insertTombstone = this.database.prepare('INSERT INTO memory_tombstones (id, target_id) VALUES (?, ?)');
      for (const tombstone of state.tombstones) insertTombstone.run(tombstone.id, tombstone.target_id);
      const setMeta = this.database.prepare(
        `INSERT INTO memory_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
      setMeta.run('canonical_hash', hash);
      setMeta.run('rebuilt_at', new Date().toISOString());
      this.database.exec('COMMIT;');
    } catch (error: unknown) {
      // BEGIN IMMEDIATE may itself fail (e.g. SQLITE_BUSY): guard the
      // rollback so it cannot mask the original failure.
      try {
        this.database.exec('ROLLBACK;');
      } catch {
        // no active transaction; nothing to undo
      }
      throw new MemoryError(`Memory index rebuild failed: ${describe(error)}`);
    }
  }

  /** BM25-ranked search over the FTS5 index. */
  public search(query: string, state: ShardState, options: IndexSearchOptions): MemoryRecord[] {
    const match = termsOf(query);
    if (!match) return [];
    const ranked = this.database
      .prepare(
        `SELECT id, bm25(memory_search) AS rank
         FROM memory_search
         WHERE memory_search MATCH ?
         ORDER BY rank ASC, id ASC`,
      )
      .all(match) as Array<{ id: string }>;
    return collectSearchResults(
      ranked.map((row) => row.id),
      new Map(state.records.map((record) => [record.id, record])),
      options,
    );
  }

  /** Removes the index file; used by tests and manual cache invalidation. */
  public static destroy(memoryRoot: string, fileName = 'index.db'): void {
    assertSafeCacheFileName(fileName);
    const dbPath = join(memoryRoot, fileName);
    assertCacheArtifactsAreRegular(dbPath);
    for (const suffix of ['', '-wal', '-shm']) {
      const path = `${dbPath}${suffix}`;
      if (existsSync(path)) rmSync(path);
    }
  }

  public close(): void {
    this.database.close();
  }
}

function assertSafeCacheFileName(fileName: string): void {
  if (!fileName || fileName === '.' || fileName === '..' || fileName !== basename(fileName) || fileName.includes('\\'))
    throw new MemoryError(`Unsafe memory cache filename: ${fileName}`);
}

function assertCacheArtifactsAreRegular(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = `${dbPath}${suffix}`;
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new MemoryError(`Unsafe memory cache artifact: ${path}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
