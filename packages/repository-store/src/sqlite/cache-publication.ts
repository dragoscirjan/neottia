import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, opendirSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { RecoveryError, ResourceLimitError } from '../errors.js';
import { assertSafeRegular, ensurePrivateDirectory, readRegularFile, syncDirectory } from '../internal/filesystem.js';
import {
  getPathState,
  getRootState,
  type ManagedPath,
  type ManagedRoot,
  type RepositoryLease,
} from '../internal/model.js';
import { publishExactRegularFile, recoverExactPublication, type ExpectedRegularFile } from '../internal/publication.js';
import { assertLiveLease, checkControl, type OperationControl } from '../lease.js';
import { resolveManagedPath, validateRelativePath } from '../paths.js';
import { computeByteRevision, isByteRevision, type ByteRevision } from '../revision.js';
import { writeDurableFile } from '../transaction/journal.js';

interface CachePublicationManifest {
  readonly version: 1;
  readonly token: string;
  readonly authorityId: string;
  readonly managedRootId: string;
  readonly path: string;
  readonly originalRevision: ByteRevision | null;
  readonly intendedRevision: ByteRevision;
  readonly createdAt: string;
  readonly digest: string;
}

const STATE_NAME = /^([0-9a-f]{64})\.(prepare|active|cleanup)$/u;

/** Recovers durable cache publications before any disposable-cache operation. */
export function recoverCachePublications(
  root: ManagedRoot,
  lease: RepositoryLease,
  options: OperationControl = {},
): void {
  assertLiveLease(root, lease);
  checkControl(options);
  const state = requireRootState(root);
  const publications = publicationRoot(state.authorityRoot, state.managedRootId);
  const entries = readDirectoryBounded(
    publications,
    state.limits.maxFiles,
    () => new ResourceLimitError('Cache publication recovery exceeds maxFiles.'),
  ).sort();
  for (const name of entries) {
    checkControl(options);
    const match = STATE_NAME.exec(name);
    if (match === null) continue;
    const token = match[1] as string;
    const phase = match[2] as 'prepare' | 'active' | 'cleanup';
    const directory = join(publications, name);
    assertStateDirectory(directory);
    if (phase === 'active') {
      const manifest = readManifest(directory, state.limits.maxJournalBytes);
      validateManifest(manifest, state.authorityId, state.managedRootId, token);
      const path = resolveManagedPath(root, manifest.path);
      const pathState = getPathState(path);
      if (pathState === undefined) throw malformed('Recovered cache path is not a repository-store handle.');
      recoverExactPublication(
        pathState.absolutePath,
        token,
        [manifest.originalRevision, manifest.intendedRevision],
        state.limits.maxTemporaryBytes,
      );
      const cleanup = join(publications, `${token}.cleanup`);
      renameSync(directory, cleanup);
      syncDirectory(publications);
      cleanupStateDirectory(cleanup, publications, state.limits.maxJournalBytes);
    } else {
      cleanupStateDirectory(directory, publications, state.limits.maxJournalBytes);
    }
  }
}

/** Publishes one cache database with a crash-recoverable random token. */
export function publishCacheDatabase(
  root: ManagedRoot,
  lease: RepositoryLease,
  path: ManagedPath,
  bytes: Uint8Array,
  expected: ExpectedRegularFile | undefined,
  options: OperationControl = {},
): void {
  assertLiveLease(root, lease);
  checkControl(options);
  const state = requireRootState(root);
  const pathState = getPathState(path);
  if (pathState === undefined) throw malformed('Cache path is not a repository-store handle.');
  const publications = publicationRoot(state.authorityRoot, state.managedRootId);
  const token = randomBytes(32).toString('hex');
  const prepare = join(publications, `${token}.prepare`);
  mkdirSync(prepare, { mode: 0o700 });
  const unsigned = {
    version: 1 as const,
    token,
    authorityId: state.authorityId,
    managedRootId: state.managedRootId,
    path: path.relativePath,
    originalRevision: expected?.revision ?? null,
    intendedRevision: computeByteRevision(bytes),
    createdAt: new Date().toISOString(),
  };
  const manifest: CachePublicationManifest = { ...unsigned, digest: digest(unsigned) };
  writeDurableFile(join(prepare, 'manifest.json'), new TextEncoder().encode(JSON.stringify(manifest)));
  syncDirectory(prepare);
  const active = join(publications, `${token}.active`);
  renameSync(prepare, active);
  syncDirectory(publications);

  let publicationError: unknown;
  try {
    publishExactRegularFile(pathState.absolutePath, bytes, expected, token);
  } catch (error: unknown) {
    publicationError = error;
    // Ordinary failures restore a usable old/new cache immediately; SIGKILL
    // leaves the active state for recoverCachePublications on the next lease.
    recoverExactPublication(
      pathState.absolutePath,
      token,
      [manifest.originalRevision, manifest.intendedRevision],
      state.limits.maxTemporaryBytes,
    );
  }
  const cleanup = join(publications, `${token}.cleanup`);
  renameSync(active, cleanup);
  syncDirectory(publications);
  cleanupStateDirectory(cleanup, publications, state.limits.maxJournalBytes);
  if (publicationError !== undefined) throw publicationError;
}

/** Returns the private state root for one managed cache namespace. */
function publicationRoot(authorityRoot: string, managedRootId: string): string {
  if (!/^[0-9a-f]{64}$/u.test(managedRootId)) throw malformed('Managed-root cache identity is invalid.');
  const path = join(authorityRoot, '.neottia', 'repository-store', 'cache-publications', managedRootId);
  ensurePrivateDirectory(path);
  return path;
}

/** Reads one bounded, digest-authenticated cache publication manifest. */
function readManifest(directory: string, maxBytes: number): CachePublicationManifest {
  const path = join(directory, 'manifest.json');
  const stat = lstatSync(path);
  assertSafeRegular(stat, path);
  if (stat.size > maxBytes) throw malformed('Cache publication manifest exceeds maxJournalBytes.');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(readRegularFile(path, maxBytes)));
  } catch (error: unknown) {
    throw malformed('Cache publication manifest is not valid JSON.', error);
  }
  if (!isManifest(value)) throw malformed('Cache publication manifest has an invalid schema.');
  const { digest: actual, ...unsigned } = value;
  if (digest(unsigned) !== actual) throw malformed('Cache publication manifest digest does not match.');
  return value;
}

/** Validates manifest authority and path bindings before recovery. */
function validateManifest(
  manifest: CachePublicationManifest,
  authorityId: string,
  managedRootId: string,
  token: string,
): void {
  if (manifest.authorityId !== authorityId || manifest.managedRootId !== managedRootId || manifest.token !== token)
    throw malformed('Cache publication identity does not match its authority or state directory.');
  validateRelativePath(manifest.path);
}

/** Removes only the exact bounded manifest from a known state directory. */
function cleanupStateDirectory(directory: string, parent: string, maxBytes: number): void {
  const entries = readDirectoryBounded(directory, 1, () =>
    malformed('Cache publication state contains more than one artifact.'),
  );
  if (entries.some((name) => name !== 'manifest.json'))
    throw malformed('Cache publication state contains an unowned artifact.');
  if (entries.includes('manifest.json')) {
    const path = join(directory, 'manifest.json');
    const stat = lstatSync(path);
    assertSafeRegular(stat, path);
    if (stat.size > maxBytes) throw malformed('Cache publication manifest exceeds maxJournalBytes.');
    rmSync(path);
  }
  rmdirSync(directory);
  syncDirectory(parent);
}

/** Reads at most the configured number of directory entries. */
function readDirectoryBounded(path: string, limit: number, overflow: () => Error): string[] {
  const directory = opendirSync(path);
  const entries: string[] = [];
  try {
    while (true) {
      const entry = directory.readSync();
      if (entry === null) return entries;
      if (entries.length >= limit) throw overflow();
      entries.push(entry.name);
    }
  } finally {
    try {
      directory.closeSync();
    } catch {
      // Some runtimes close a directory automatically after its final entry.
    }
  }
}

/** Rejects links and non-directory cache publication states. */
function assertStateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw malformed(`Unsafe cache publication state path: ${path}`);
}

/** Calculates the self-authentication digest for a publication manifest. */
function digest(manifest: Omit<CachePublicationManifest, 'digest'>): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

/** Checks the strict persisted manifest schema. */
function isManifest(value: unknown): value is CachePublicationManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Partial<CachePublicationManifest>;
  return (
    manifest.version === 1 &&
    typeof manifest.token === 'string' &&
    /^[0-9a-f]{64}$/u.test(manifest.token) &&
    typeof manifest.authorityId === 'string' &&
    /^[0-9a-f]{64}$/u.test(manifest.authorityId) &&
    typeof manifest.managedRootId === 'string' &&
    /^[0-9a-f]{64}$/u.test(manifest.managedRootId) &&
    typeof manifest.path === 'string' &&
    (manifest.originalRevision === null || isByteRevision(manifest.originalRevision)) &&
    isByteRevision(manifest.intendedRevision) &&
    typeof manifest.createdAt === 'string' &&
    typeof manifest.digest === 'string' &&
    /^[0-9a-f]{64}$/u.test(manifest.digest)
  );
}

/** Returns private state for a package-created root. */
function requireRootState(root: ManagedRoot): NonNullable<ReturnType<typeof getRootState>> {
  const state = getRootState(root);
  if (state === undefined) throw malformed('Managed root is not a repository-store handle.');
  return state;
}

/** Creates a structured malformed-recovery failure. */
function malformed(message: string, cause?: unknown): RecoveryError {
  return new RecoveryError(message, 'RECOVERY_MALFORMED', undefined, cause === undefined ? undefined : { cause });
}
