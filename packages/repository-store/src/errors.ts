/** Stable error categories exposed by repository-store operations. */
export type RepositoryStoreErrorCategory =
  | 'config'
  | 'path_safety'
  | 'resource_limit'
  | 'stale_revision'
  | 'contention'
  | 'durability'
  | 'recovery'
  | 'cache_sync';

/** Stable machine-readable codes for expected storage failures. */
export type RepositoryStoreErrorCode =
  | 'AUTHORITY_MISMATCH'
  | 'PATH_INVALID'
  | 'PATH_COLLISION'
  | 'UNSAFE_LINK'
  | 'UNSAFE_HARD_LINK'
  | 'IDENTITY_CHANGED'
  | 'LIMIT_EXCEEDED'
  | 'REVISION_MISMATCH'
  | 'LEASE_BUSY'
  | 'LEASE_REENTRANT'
  | 'LEASE_OWNER_UNKNOWN'
  | 'ABORTED'
  | 'DEADLINE_EXCEEDED'
  | 'FSYNC_FAILED'
  | 'RECOVERY_MALFORMED'
  | 'RECOVERY_AMBIGUOUS'
  | 'CACHE_BUSY'
  | 'CACHE_UNSAFE'
  | 'CACHE_SYNC_FAILED'
  | 'UNSUPPORTED_RUNTIME';

/** Base class carrying stable diagnostics without coupling to a domain. */
export class RepositoryStoreError extends Error {
  public constructor(
    message: string,
    public readonly category: RepositoryStoreErrorCategory,
    public readonly code: RepositoryStoreErrorCode,
    public readonly retryable: boolean,
    public readonly evidence?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RepositoryStoreError';
  }
}

/** Invalid authority or option configuration. */
export class RepositoryStoreConfigError extends RepositoryStoreError {
  public constructor(message: string, code: RepositoryStoreErrorCode = 'PATH_INVALID') {
    super(message, 'config', code, false);
    this.name = 'RepositoryStoreConfigError';
  }
}

/** A path, link, or filesystem identity failed closed. */
export class PathSafetyError extends RepositoryStoreError {
  public constructor(
    message: string,
    code: RepositoryStoreErrorCode = 'PATH_INVALID',
    evidence?: Readonly<Record<string, unknown>>,
  ) {
    super(message, 'path_safety', code, false, evidence);
    this.name = 'PathSafetyError';
  }
}

/** A configured storage bound was exceeded before publication. */
export class ResourceLimitError extends RepositoryStoreError {
  public constructor(message: string, evidence?: Readonly<Record<string, unknown>>) {
    super(message, 'resource_limit', 'LIMIT_EXCEEDED', false, evidence);
    this.name = 'ResourceLimitError';
  }
}

/** An optimistic byte revision did not match current canonical bytes. */
export class StaleRevisionError extends RepositoryStoreError {
  public constructor(message: string, evidence?: Readonly<Record<string, unknown>>) {
    super(message, 'stale_revision', 'REVISION_MISMATCH', true, evidence);
    this.name = 'StaleRevisionError';
  }
}

/** Lease acquisition could not safely proceed. */
export class LeaseContentionError extends RepositoryStoreError {
  public constructor(message: string, code: RepositoryStoreErrorCode = 'LEASE_BUSY') {
    super(message, 'contention', code, true);
    this.name = 'LeaseContentionError';
  }
}

/** A durable filesystem operation failed. */
export class DurabilityError extends RepositoryStoreError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 'durability', 'FSYNC_FAILED', false, undefined, options);
    this.name = 'DurabilityError';
  }
}

/** Recovery evidence was malformed or inconsistent with canonical state. */
export class RecoveryError extends RepositoryStoreError {
  public constructor(
    message: string,
    code: 'RECOVERY_MALFORMED' | 'RECOVERY_AMBIGUOUS',
    evidence?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, 'recovery', code, false, evidence, options);
    this.name = 'RecoveryError';
  }
}

/** Disposable cache synchronization failed; canonical files remain authoritative. */
export class CacheSyncError extends RepositoryStoreError {
  public constructor(message: string, code: RepositoryStoreErrorCode = 'CACHE_SYNC_FAILED', options?: ErrorOptions) {
    super(message, 'cache_sync', code, code === 'CACHE_BUSY', undefined, options);
    this.name = 'CacheSyncError';
  }
}

/** The current JavaScript runtime has no supported SQLite adapter. */
export class UnsupportedRuntimeError extends RepositoryStoreError {
  public constructor(message: string) {
    super(message, 'config', 'UNSUPPORTED_RUNTIME', false);
    this.name = 'UnsupportedRuntimeError';
  }
}
