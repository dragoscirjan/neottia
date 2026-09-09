import { randomUUID } from 'node:crypto';
import { lstatSync, renameSync, rmSync, type Stats } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CacheSyncError, PathSafetyError, RepositoryStoreError, ResourceLimitError } from '../errors.js';
import type { SqliteConnection, SqliteParameters, SqliteStatement } from './adapter.js';
import {
  assertSafeRegular,
  captureDirectories,
  hasCode,
  revalidateDirectories,
  sameIdentity,
  syncDirectory,
  syncRegularFile,
} from '../internal/filesystem.js';
import {
  PATH_STATE,
  ROOT_STATE,
  managedPathBelongsToRoot,
  type ManagedPath,
  type ManagedRoot,
  type RepositoryLease,
} from '../internal/model.js';
import { assertLiveLease, checkControl, type OperationControl } from '../lease.js';
import { selectSqliteAdapter } from './runtime.js';

/** Domain-owned schema and projection callbacks for a disposable cache. */
export interface DisposableCacheSpecification {
  readonly path: ManagedPath;
  readonly applicationId: number;
  readonly schemaVersion: number;
  readonly canonicalDigest: string;
  readonly schemaSql: readonly string[];
  populate(database: SqliteConnection): Promise<void>;
  healthCheck(database: SqliteConnection): Promise<void>;
}

/** Open cache handle; callers must close it. */
export interface DisposableSqliteCache {
  readonly state: 'ready';
  readonly database: SqliteConnection;
  close(): Promise<void>;
}

export type CacheRebuildReason =
  'missing' | 'corrupt' | 'wrong-application' | 'wrong-schema' | 'stale-digest' | 'failed-integrity' | 'contradictory';

/** Cache open either returns a verified handle or a precise rebuild reason. */
export type CacheOpenResult =
  DisposableSqliteCache | { readonly state: 'rebuild-required'; readonly reason: CacheRebuildReason };

/** Opens and verifies a cache without treating unsafe artifacts as corruption. */
export async function openDisposableSqliteCache(
  root: ManagedRoot,
  lease: RepositoryLease,
  specification: DisposableCacheSpecification,
  options: OperationControl = {},
): Promise<CacheOpenResult> {
  assertLiveLease(root, lease);
  checkControl(options);
  assertCachePath(root, specification.path);
  const path = specification.path[PATH_STATE].absolutePath;
  if (!artifactExists(path)) return { state: 'rebuild-required', reason: 'missing' };
  const beforeOpen = captureCacheState(path);
  const adapter = await selectSqliteAdapter();
  let database: SqliteConnection | undefined;
  let closeSnapshot = beforeOpen;
  try {
    database = await adapter.open(path, { readOnly: false, busyTimeoutMs: 5_000 });
    revalidateCacheState(path, closeSnapshot);
    checkControl(options);
    closeSnapshot = captureCacheState(path);
    const reason = await verifyDatabase(root, database, specification, {
      beforeHealthCheck() {
        closeSnapshot = captureCacheState(path);
      },
      afterHealthCheck() {
        revalidateCacheState(path, closeSnapshot);
      },
    });
    revalidateCacheState(path, closeSnapshot);
    checkControl(options);
    if (reason !== undefined) {
      const closeError = await closeDatabaseIfSafe(database, path, closeSnapshot);
      database = undefined;
      if (closeError !== undefined) throw closeError;
      return { state: 'rebuild-required', reason };
    }
    const connection = bindConnectionToLease(root, lease, path, database);
    return { state: 'ready', database: connection, close: () => connection.close() };
  } catch (error: unknown) {
    const closeError = database === undefined ? undefined : await closeDatabaseIfSafe(database, path, closeSnapshot);
    if (closeError instanceof RepositoryStoreError) throw closeError;
    if (error instanceof CacheSyncError && error.code === 'CACHE_BUSY') throw error;
    if (error instanceof RepositoryStoreError && !(error instanceof CacheSyncError)) throw error;
    assertSafeArtifacts(path);
    return { state: 'rebuild-required', reason: 'corrupt' };
  }
}

/** Builds a verified candidate and atomically activates it under the lease. */
export async function rebuildDisposableSqliteCache(
  root: ManagedRoot,
  lease: RepositoryLease,
  specification: DisposableCacheSpecification,
  options: OperationControl = {},
): Promise<DisposableSqliteCache> {
  assertLiveLease(root, lease);
  checkControl(options);
  assertCachePath(root, specification.path);
  const rootState = root[ROOT_STATE];
  const path = specification.path[PATH_STATE].absolutePath;
  const parent = dirname(path);
  const candidate = join(parent, `.${basename(path)}.${randomUUID()}.candidate`);
  assertArtifactsAbsent(candidate);
  // The active cache is not touched while the candidate is populated. This
  // exact snapshot prevents activation from deleting or replacing artifacts
  // substituted during any awaited domain callback.
  const activeSnapshot = captureCacheState(path);
  const adapter = await selectSqliteAdapter();
  let database: SqliteConnection | undefined;
  let candidateSnapshot: CacheStateSnapshot | undefined;
  try {
    database = await adapter.open(candidate, { readOnly: false, busyTimeoutMs: 5_000 });
    candidateSnapshot = captureCacheState(candidate);
    checkControl(options);
    await database.exec('PRAGMA journal_mode=WAL;');
    await database.exec(`PRAGMA application_id=${integer(specification.applicationId, 'applicationId')};`);
    await database.exec(`PRAGMA user_version=${integer(specification.schemaVersion, 'schemaVersion')};`);
    await database.exec('CREATE TABLE neottia_repository_cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    for (const sql of specification.schemaSql) {
      if (Buffer.byteLength(sql) > rootState.limits.maxSqlBytes)
        throw new ResourceLimitError('Cache schema statement exceeds maxSqlBytes.');
      await database.exec(sql);
    }
    await database.exec('BEGIN IMMEDIATE;');
    try {
      candidateSnapshot = captureCacheState(candidate);
      await specification.populate(database);
      revalidateCacheState(candidate, candidateSnapshot);
      checkControl(options);
      const metadata = await database.prepare('INSERT INTO neottia_repository_cache_meta (key, value) VALUES (?, ?)');
      await metadata.run(['canonical_digest', specification.canonicalDigest]);
      await metadata.run(['rebuilt_at', new Date().toISOString()]);
      checkControl(options);
      await database.exec('COMMIT;');
    } catch (error: unknown) {
      // Rollback is safe only while the candidate still names the same files.
      if (candidateSnapshot !== undefined) revalidateCacheState(candidate, candidateSnapshot);
      try {
        await database.exec('ROLLBACK;');
      } catch {
        // BEGIN may have failed; retain the original callback error.
      }
      throw error;
    }
    checkControl(options);
    candidateSnapshot = captureCacheState(candidate);
    const reason = await verifyDatabase(root, database, specification, {
      beforeHealthCheck() {
        candidateSnapshot = captureCacheState(candidate);
      },
      afterHealthCheck() {
        revalidateCacheState(candidate, candidateSnapshot as CacheStateSnapshot);
      },
    });
    revalidateCacheState(candidate, candidateSnapshot);
    checkControl(options);
    if (reason !== undefined) throw new CacheSyncError(`Rebuilt cache failed verification: ${reason}.`);
    await database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    revalidateCacheState(candidate, candidateSnapshot);
    checkControl(options);
    const closeError = await closeDatabaseIfSafe(database, candidate, candidateSnapshot);
    database = undefined;
    if (closeError !== undefined) throw closeError;
    candidateSnapshot = captureCacheState(candidate);
    candidateSnapshot = removeExactSidecars(candidate, candidateSnapshot);
    syncRegularFile(candidate);
    const candidateIdentity = lstatSync(candidate);
    assertSafeRegular(candidateIdentity, candidate);
    checkControl(options);
    let activationSnapshot = activeSnapshot;
    revalidateExactCacheState(path, activationSnapshot);
    activationSnapshot = removeExactSidecars(path, activationSnapshot);
    revalidateExactCacheState(path, activationSnapshot);
    renameSync(candidate, path);
    candidateSnapshot = undefined;
    const destinationIdentity = lstatSync(path);
    if (!sameIdentity(candidateIdentity, destinationIdentity))
      throw new PathSafetyError('Cache destination changed during activation.', 'IDENTITY_CHANGED');
    revalidateDirectories(activationSnapshot.parents);
    syncDirectory(parent);
  } catch (error: unknown) {
    let cleanupSafetyError: unknown;
    if (database !== undefined && candidateSnapshot !== undefined) {
      cleanupSafetyError = await closeDatabaseIfSafe(database, candidate, candidateSnapshot);
      if (cleanupSafetyError === undefined) {
        database = undefined;
        candidateSnapshot = captureCacheState(candidate);
      }
    }
    if (database === undefined && candidateSnapshot !== undefined) {
      try {
        removeExactArtifacts(candidate, candidateSnapshot);
      } catch (cleanupError: unknown) {
        cleanupSafetyError ??= cleanupError;
      }
    }
    if (cleanupSafetyError instanceof RepositoryStoreError) throw cleanupSafetyError;
    if (error instanceof RepositoryStoreError) throw error;
    throw new CacheSyncError(
      'Disposable cache rebuild failed; canonical files remain committed.',
      'CACHE_SYNC_FAILED',
      {
        cause: error,
      },
    );
  }
  const opened = await openDisposableSqliteCache(root, lease, specification, options);
  if (opened.state !== 'ready') throw new CacheSyncError(`Activated cache failed verification: ${opened.reason}.`);
  return opened;
}

interface CacheStateSnapshot {
  readonly parents: ReturnType<typeof captureDirectories>;
  readonly artifacts: Map<string, Stats>;
}

/** Prevents a writable cache handle from escaping its repository lease. */
function bindConnectionToLease(
  root: ManagedRoot,
  lease: RepositoryLease,
  path: string,
  database: SqliteConnection,
): SqliteConnection {
  const openedState = captureCacheState(path);
  const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
    revalidateCacheState(path, openedState);
    assertLiveLease(root, lease);
    const result = await operation();
    revalidateCacheState(path, openedState);
    return result;
  };
  const wrapStatement = (statement: SqliteStatement): SqliteStatement => ({
    run: (parameters?: SqliteParameters) => guarded(() => statement.run(parameters)),
    get: <T>(parameters?: SqliteParameters) => guarded(() => statement.get<T>(parameters)),
    all: <T>(parameters: SqliteParameters | undefined, bounds: { maxRows: number; maxBytes: number }) =>
      guarded(() => statement.all<T>(parameters, bounds)),
  });
  let closed = false;
  return {
    exec: (sql) => guarded(() => database.exec(sql)),
    prepare: (sql) => guarded(async () => wrapStatement(await database.prepare(sql))),
    async close() {
      if (closed) return;
      closed = true;
      // Closing must remain possible after lease invalidation to avoid leaking
      // the native handle; identity is still checked around the close.
      // Do not let SQLite close unlink a substituted WAL/SHM artifact.
      revalidateCacheState(path, openedState);
      await database.close();
      revalidateCacheState(path, openedState);
    },
  };
}

function captureCacheState(path: string): CacheStateSnapshot {
  const parents = captureDirectories(dirname(path));
  assertSafeArtifacts(path);
  const artifacts = new Map<string, Stats>();
  for (const suffix of ['', '-wal', '-shm']) {
    const artifact = `${path}${suffix}`;
    try {
      artifacts.set(suffix, lstatSync(artifact));
    } catch (error: unknown) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }
  revalidateDirectories(parents);
  return { parents, artifacts };
}

function revalidateCacheState(path: string, snapshot: CacheStateSnapshot): void {
  revalidateDirectories(snapshot.parents);
  for (const [suffix, previous] of snapshot.artifacts) {
    const artifact = `${path}${suffix}`;
    let current: Stats;
    try {
      current = lstatSync(artifact);
    } catch (error: unknown) {
      if (suffix !== '' && hasCode(error, 'ENOENT')) continue;
      throw new PathSafetyError(`Cache artifact changed during access: ${artifact}`, 'IDENTITY_CHANGED');
    }
    assertSafeRegular(current, artifact);
    if (!sameIdentity(previous, current))
      throw new PathSafetyError(`Cache artifact changed during access: ${artifact}`, 'IDENTITY_CHANGED');
  }
  assertSafeArtifacts(path);
  for (const suffix of ['', '-wal', '-shm']) {
    if (snapshot.artifacts.has(suffix)) continue;
    const artifact = `${path}${suffix}`;
    try {
      snapshot.artifacts.set(suffix, lstatSync(artifact));
    } catch (error: unknown) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }
  revalidateDirectories(snapshot.parents);
}

/** Requires exact artifact presence and identity without enrolling new files. */
function revalidateExactCacheState(path: string, snapshot: CacheStateSnapshot): void {
  revalidateDirectories(snapshot.parents);
  for (const suffix of ['', '-wal', '-shm']) {
    const previous = snapshot.artifacts.get(suffix);
    try {
      const current = lstatSync(`${path}${suffix}`);
      if (previous === undefined) throw new PathSafetyError(`Cache artifact appeared during access: ${path}${suffix}`);
      assertSafeRegular(current, `${path}${suffix}`);
      if (!sameIdentity(previous, current))
        throw new PathSafetyError(`Cache artifact changed during access: ${path}${suffix}`, 'IDENTITY_CHANGED');
    } catch (error: unknown) {
      if (previous === undefined && hasCode(error, 'ENOENT')) continue;
      if (error instanceof RepositoryStoreError) throw error;
      throw new PathSafetyError(`Cache artifact changed during access: ${path}${suffix}`, 'IDENTITY_CHANGED');
    }
  }
  revalidateDirectories(snapshot.parents);
}

/** Closes only while SQLite's path artifacts retain their verified identity. */
async function closeDatabaseIfSafe(
  database: SqliteConnection,
  path: string,
  snapshot: CacheStateSnapshot,
): Promise<unknown | undefined> {
  try {
    revalidateCacheState(path, snapshot);
  } catch (error: unknown) {
    return error;
  }
  try {
    await database.close();
  } catch (error: unknown) {
    return error;
  }
  try {
    revalidateCacheState(path, snapshot);
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

/** Removes only sidecars from an exact, previously captured snapshot. */
function removeExactSidecars(path: string, snapshot: CacheStateSnapshot): CacheStateSnapshot {
  revalidateExactCacheState(path, snapshot);
  const remaining = new Map(snapshot.artifacts);
  for (const suffix of ['-wal', '-shm']) {
    const previous = remaining.get(suffix);
    if (previous === undefined) continue;
    const artifact = `${path}${suffix}`;
    const current = lstatSync(artifact);
    assertSafeRegular(current, artifact);
    if (!sameIdentity(previous, current))
      throw new PathSafetyError(`Cache artifact changed during removal: ${artifact}`, 'IDENTITY_CHANGED');
    rmSync(artifact);
    remaining.delete(suffix);
  }
  const next = { parents: snapshot.parents, artifacts: remaining };
  revalidateExactCacheState(path, next);
  return next;
}

/** Removes an exact package-created candidate without touching replacements. */
function removeExactArtifacts(path: string, snapshot: CacheStateSnapshot): void {
  let remaining = removeExactSidecars(path, snapshot);
  const database = remaining.artifacts.get('');
  if (database !== undefined) {
    const current = lstatSync(path);
    assertSafeRegular(current, path);
    if (!sameIdentity(database, current))
      throw new PathSafetyError(`Cache candidate changed during cleanup: ${path}`, 'IDENTITY_CHANGED');
    rmSync(path);
    remaining = { parents: remaining.parents, artifacts: new Map() };
  }
  revalidateExactCacheState(path, remaining);
}

async function verifyDatabase(
  root: ManagedRoot,
  database: SqliteConnection,
  specification: DisposableCacheSpecification,
  healthGuard?: { readonly beforeHealthCheck: () => void; readonly afterHealthCheck: () => void },
): Promise<CacheRebuildReason | undefined> {
  const bounds = {
    maxRows: root[ROOT_STATE].limits.maxQueryRows,
    maxBytes: root[ROOT_STATE].limits.maxQueryResultBytes,
  };
  const application = await (await database.prepare('PRAGMA application_id')).get<{ application_id: number }>();
  if (application?.application_id !== specification.applicationId) return 'wrong-application';
  const schema = await (await database.prepare('PRAGMA user_version')).get<{ user_version: number }>();
  if (schema?.user_version !== specification.schemaVersion) return 'wrong-schema';
  const integrity = await (
    await database.prepare('PRAGMA integrity_check')
  ).all<{ integrity_check: string }>(undefined, bounds);
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') return 'failed-integrity';
  let digest: { value: string } | undefined;
  try {
    digest = await (
      await database.prepare("SELECT value FROM neottia_repository_cache_meta WHERE key='canonical_digest'")
    ).get<{ value: string }>();
  } catch {
    return 'contradictory';
  }
  if (digest?.value !== specification.canonicalDigest) return 'stale-digest';
  healthGuard?.beforeHealthCheck();
  let healthError: unknown;
  try {
    await specification.healthCheck(database);
  } catch (error: unknown) {
    healthError = error;
  }
  // Safety validation must run even when domain health checking fails; a path
  // substitution is not disposable corruption and must remain fail-closed.
  healthGuard?.afterHealthCheck();
  if (healthError !== undefined) return 'contradictory';
  return undefined;
}

function assertCachePath(root: ManagedRoot, path: ManagedPath): void {
  if (!managedPathBelongsToRoot(root, path))
    throw new PathSafetyError('Cache path belongs to a different managed root.');
  if (path.relativePath.split('/').length === 0) throw new PathSafetyError('Cache path must name a file.');
}

function assertSafeArtifacts(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const artifact = `${path}${suffix}`;
    try {
      assertSafeRegular(lstatSync(artifact), artifact);
    } catch (error: unknown) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }
}

function assertArtifactsAbsent(path: string): void {
  for (const suffix of ['', '-wal', '-shm'])
    if (artifactExists(`${path}${suffix}`))
      throw new PathSafetyError(`Cache candidate already exists: ${path}${suffix}`);
}

function artifactExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new CacheSyncError(`${name} must be a nonnegative integer.`);
  return value;
}
