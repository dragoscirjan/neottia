/** Domain-neutral repository-local persistence primitives. */
export {
  CacheSyncError,
  DurabilityError,
  LeaseContentionError,
  PathSafetyError,
  RecoveryError,
  RepositoryStoreConfigError,
  RepositoryStoreError,
  ResourceLimitError,
  StaleRevisionError,
  UnsupportedRuntimeError,
  type RepositoryStoreErrorCategory,
  type RepositoryStoreErrorCode,
} from './errors.js';
export { readManagedFile, scanManagedFiles, type ManagedFile, type ScanManagedFilesOptions } from './files.js';
export {
  withRepositoryLease,
  type OperationControl,
  type RepositoryLease,
  type RepositoryLeaseOptions,
} from './lease.js';
export { DEFAULT_STORE_LIMITS, type StoreLimits } from './limits.js';
export {
  resolveManagedPath,
  resolveManagedRoot,
  validateRelativePath,
  type ManagedPath,
  type ManagedRoot,
  type ManagedRootOptions,
} from './paths.js';
export { computeByteRevision, type ByteRevision } from './revision.js';
export {
  openDisposableSqliteCache,
  rebuildDisposableSqliteCache,
  removeDisposableSqliteCache,
} from './sqlite/cache.js';
export type {
  CacheOpenResult,
  CacheRebuildReason,
  DisposableCacheSpecification,
  DisposableSqliteCache,
} from './sqlite/cache.js';
export { selectSqliteAdapter } from './sqlite/runtime.js';
export type {
  SqliteAdapter,
  SqliteConnection,
  SqliteConnectionBounds,
  SqliteParameters,
  SqliteRunResult,
  SqliteStatement,
  SqliteValue,
} from './sqlite/adapter.js';
export { applyCanonicalBatch } from './transaction/apply.js';
export { recoverCanonicalTransactions } from './transaction/recovery.js';
export type { ApplyCanonicalBatchOptions, CanonicalOperation, RecoveryReport } from './transaction/types.js';
