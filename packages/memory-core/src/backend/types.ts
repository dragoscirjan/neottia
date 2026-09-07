import type { MemoryRecord, MemoryTombstone } from '../schemas.js';

/**
 * Storage contract every memory backend implements. The filesystem backend
 * (canonical YAML + SQLite index) ships first; Postgres follows behind the
 * same interface (neottia#1, child issue #6).
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
  /** Deterministic hash of canonical file paths + bytes; detects content drift. */
  readonly contentHash: string;
}

export interface StorageLimits {
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
}

export interface StorageBackend {
  /** Loads the full shard state; called inside a barrier lease. */
  loadState(): ShardState;
  /** Applies file replacements atomically with rollback. */
  applyBatch(replacements: readonly StorageReplacement[]): void;
}
