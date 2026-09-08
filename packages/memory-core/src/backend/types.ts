import type { MemoryRecord, MemoryTombstone } from '../schemas.js';
import type { MemoryRecordInput } from './filesystem.js';

/**
 * Storage contract every memory backend implements. The filesystem backend
 * (canonical YAML + SQLite index) is the default; the Postgres backend keeps
 * records as JSONB documents in PostgreSQL (issue #6).
 *
 * All operations are asynchronous: remote backends are I/O-bound, and the
 * store serializes every caller through these promises.
 */

export interface NamespaceScope {
  readonly organizationId: string;
  readonly projectId: string;
  readonly scope: string;
}

/** File replacement inside an atomic batch; `exclusive` fails if the path exists. */
export interface StorageReplacement {
  readonly path: string;
  readonly bytes?: Uint8Array;
  readonly exclusive?: boolean;
}

export interface ShardState {
  readonly records: MemoryRecord[];
  readonly tombstones: MemoryTombstone[];
  /** IDs of records that are neither superseded nor tombstoned. */
  readonly activeIds: ReadonlySet<string>;
  /** Deterministic hash of canonical content; detects index drift. */
  readonly contentHash: string;
}

export interface StorageLimits {
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
}

/** Ranked search input (subset of the store's search options). */
export interface BackendSearchOptions {
  readonly limit: number;
  readonly maxChars: number;
  readonly topic?: string;
  readonly memoryType?: string;
  readonly includeSuperseded?: boolean;
  readonly activeIds: ReadonlySet<string>;
}

/** Report of a cache verification pass (memory_validate). */
export interface CacheValidation {
  outcome: 'checked' | 'rebuilt';
  evidence: 'canonical_snapshot_match_verified' | 'canonical_snapshot_rebuild_verified';
}

export interface StorageBackend {
  /** Loads the full shard state. */
  loadState(): Promise<ShardState>;
  /** Applies file replacements atomically with rollback. */
  applyBatch(replacements: readonly StorageReplacement[]): Promise<void>;
  /** BM25-ranked search scoped to the shard. */
  search(state: ShardState, query: string, options: BackendSearchOptions): Promise<MemoryRecord[]>;
  /**
   * Runs the operation while holding the shard-scoped lock. Remote backends
   * use transaction-scoped advisory locks; the filesystem backend uses its
   * lock directory.
   */
  withLock<T>(operation: () => Promise<T>): Promise<T>;
  /** Verifies (and rebuilds when stale) the backend's search index. */
  checkOrRebuildCache(state: ShardState): Promise<CacheValidation>;
  /** Disposes the search index (used by tests and cache invalidation). */
  resetCache(): Promise<void>;
  /** Releases backend resources (connections, watchers). */
  close(): Promise<void>;

  // -- shared record helpers (identical semantics across backends) ---------

  /** Creates a validated record with a fresh ULID and the configured scope. */
  makeRecord(input: MemoryRecordInput, supersedes: string[], now: () => Date): MemoryRecord;
  /** Validates and returns a tombstone object for a target record. */
  makeTombstone(
    targetId: string,
    reason: string,
    source: MemoryTombstone['source'],
    createdBy: string,
    now: () => Date,
  ): MemoryTombstone;
  /** Enforces write-time summary/details compactness. */
  validateCompactness(summary: string, details: string | null | undefined, context: string): void;
  /** Validates imported documents against this backend's namespace and security policy. */
  validateRecord(value: unknown, label?: string): MemoryRecord;
  validateTombstone(value: unknown, label?: string): MemoryTombstone;
  /** Canonical path for a record (backend namespace). */
  recordPath(record: MemoryRecord): string;
  /** Canonical path for a tombstone (backend namespace). */
  tombstonePath(tombstone: MemoryTombstone): string;
  /** Serializes a record or tombstone. */
  encode(value: MemoryRecord | MemoryTombstone): Uint8Array;
}
