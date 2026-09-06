import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { searchableText } from './backend/filesystem.js';
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
    const dbPath = join(memoryRoot, fileName);
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
    if (Date.now() - Date.parse(rebuiltAt) > maxAgeMs) return true;
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
      this.database.exec('ROLLBACK;');
      throw new MemoryError(`Memory index rebuild failed: ${describe(error)}`);
    }
  }

  /**
   * BM25-ranked search over the FTS5 index. Ranked results are mapped back
   * to canonical records, filtered, and bounded by both limit and the
   * JSON-size budget inherited from the v1 semantics.
   */
  public search(query: string, state: ShardState, options: IndexSearchOptions): MemoryRecord[] {
    const terms = query
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map((term) => term.replace(/"/gu, '""'));
    if (!terms.length) return [];
    // Prefix phrases: "term"* keeps v1 substring-like recall while bm25 ranks.
    const match = terms.map((term) => `"${term}"*`).join(' AND ');

    let ranked: Array<{ id: string }>;
    try {
      ranked = this.database
        .prepare(
          `SELECT id, bm25(memory_search) AS rank
           FROM memory_search
           WHERE memory_search MATCH ?
           ORDER BY rank ASC, id ASC
           LIMIT ?`,
        )
        .all(match, options.limit * 4) as Array<{ id: string }>;
    } catch (error: unknown) {
      throw new MemoryError(`Memory search failed: ${describe(error)}`);
    }

    const byId = new Map(state.records.map((record) => [record.id, record]));
    const results: MemoryRecord[] = [];
    let used = 0;
    for (const { id } of ranked) {
      if (results.length >= options.limit) break;
      const record = byId.get(id);
      if (!record) continue;
      if (!(options.includeSuperseded ?? false) && !options.activeIds.has(record.id)) continue;
      if (options.topic && record.topic !== options.topic) continue;
      if (options.memoryType && record.memory_type !== options.memoryType) continue;
      const size = JSON.stringify(record).length;
      if (used + size > options.maxChars) break;
      results.push(record);
      used += size;
    }
    // FTS rank order is authoritative; do not reorder results here.
    return results;
  }

  /** Removes the index file; used by tests and manual cache invalidation. */
  public static destroy(memoryRoot: string, fileName = 'index.db'): void {
    for (const suffix of ['', '-wal', '-shm']) {
      const path = join(memoryRoot, `${fileName}${suffix}`);
      if (existsSync(path)) rmSync(path);
    }
  }

  public close(): void {
    this.database.close();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
