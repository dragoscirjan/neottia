import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  rmSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { PathSafetyError, RecoveryError, UnsupportedRuntimeError } from '../errors.js';
import { computeByteRevision, type ByteRevision } from '../revision.js';
import { emitFilesystemFault } from './fault-injection.js';
import {
  assertSafeRegular,
  captureDirectories,
  ensurePrivateDirectory,
  hasCode,
  noFollowFlag,
  readRegularFile,
  revalidateDirectories,
  sameIdentity,
  syncDirectory,
  syncFileDescriptor,
} from './filesystem.js';
import {
  assertNativePublicationPath,
  nativeRenameNoReplace,
  requireNativePublicationBackend,
  type NativePublicationBackend,
} from './native-publication.js';

/** Identity and revision captured by the final pre-publication read. */
export interface ExpectedRegularFile {
  readonly identity: Stats;
  readonly revision: ByteRevision;
  readonly maxBytes: number;
}

/**
 * Publishes without ever replacing an unchecked destination. Existing entries
 * are first atomically evacuated, authenticated, and restored exclusively on
 * mismatch. Hard links provide create-if-absent publication for regular files.
 */
export function publishExactRegularFile(
  path: string,
  bytes: Uint8Array | null,
  expected: ExpectedRegularFile | undefined,
  token: string,
): void {
  const parent = dirname(path);
  ensurePrivateDirectory(parent);
  const parents = captureDirectories(parent);
  const temporary = join(parent, `.${basename(path)}.${token}.repository-store.tmp`);
  const evacuated = join(parent, `.${basename(path)}.${token}.repository-store.evacuated`);
  // Backend loading and platform checks happen before staging or destination mutation.
  const nativeBackend = expected === undefined ? undefined : requireNativePublicationBackend();
  if (nativeBackend !== undefined) assertNativePublicationPath(nativeBackend, parent);
  let descriptor: number | undefined;
  let temporaryIdentity: Stats | undefined;
  let evacuatedIdentity: Stats | undefined;
  try {
    if (artifactExists(evacuated))
      throw new RecoveryError('A prior exact-publication evacuation requires recovery.', 'RECOVERY_AMBIGUOUS', {
        path,
        evacuated,
      });
    if (bytes !== null) {
      descriptor = openSync(
        temporary,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollowFlag(),
        0o600,
      );
      writeFileSync(descriptor, bytes);
      syncFileDescriptor(descriptor, temporary);
      temporaryIdentity = fstatSync(descriptor);
      assertSafeRegular(temporaryIdentity, temporary);
      closeSync(descriptor);
      descriptor = undefined;
    }

    if (expected !== undefined) {
      emitFilesystemFault(bytes === null ? 'before-exact-removal' : 'before-exact-publication', path);
      emitFilesystemFault('before-exact-evacuation', evacuated);
      moveNoReplace(nativeBackend as NativePublicationBackend, path, evacuated, 'evacuate destination');
      emitFilesystemFault('destination-evacuated', path);
      evacuatedIdentity = lstatSync(evacuated);
      assertSafeRegular(evacuatedIdentity, evacuated);
      const evacuatedBytes = readRegularFile(evacuated, expected.maxBytes);
      if (
        !sameIdentity(expected.identity, evacuatedIdentity) ||
        computeByteRevision(evacuatedBytes) !== expected.revision
      ) {
        restoreEvacuated(nativeBackend as NativePublicationBackend, evacuated, path, parent);
        evacuatedIdentity = undefined;
        throw new PathSafetyError(`Destination changed during publication: ${path}`, 'IDENTITY_CHANGED', {
          path,
        });
      }
      revalidateDirectories(parents);
      syncDirectory(parent);
    } else if (bytes !== null) {
      emitFilesystemFault('before-exact-publication', path);
    }

    if (bytes !== null) {
      try {
        linkSync(temporary, path);
      } catch (error: unknown) {
        if (hasCode(error, 'EEXIST')) {
          if (evacuatedIdentity !== undefined)
            restoreEvacuated(nativeBackend as NativePublicationBackend, evacuated, path, parent);
          evacuatedIdentity = undefined;
          throw new PathSafetyError(`Destination appeared during publication: ${path}`, 'IDENTITY_CHANGED');
        }
        throw unsupportedLink(error, path);
      }
      emitFilesystemFault('exclusive-destination-published', path);
      const destination = lstatSync(path);
      if (temporaryIdentity === undefined || !sameIdentity(temporaryIdentity, destination))
        throw new PathSafetyError(`Destination changed during publication: ${path}`, 'IDENTITY_CHANGED');
      rmSync(temporary);
      temporaryIdentity = undefined;
      revalidateDirectories(parents);
      syncDirectory(parent);
    }

    if (evacuatedIdentity !== undefined) {
      const current = lstatSync(evacuated);
      if (!sameIdentity(evacuatedIdentity, current))
        throw new RecoveryError('Evacuated publication evidence changed before cleanup.', 'RECOVERY_AMBIGUOUS', {
          path,
          evacuated,
        });
      rmSync(evacuated);
      evacuatedIdentity = undefined;
      syncDirectory(parent);
    } else if (bytes === null) {
      // Removing an expected-absent path is a no-op.
      revalidateDirectories(parents);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      revalidateDirectories(parents);
      if (temporaryIdentity !== undefined && artifactExists(temporary)) {
        const current = lstatSync(temporary);
        if (sameIdentity(temporaryIdentity, current)) rmSync(temporary);
      }
    } catch {
      // Preserve uncertain artifacts rather than traversing a rebound parent.
    }
  }
}

/** Restores an evacuated entry without overwriting a newly appeared path. */
/** Resolves a crash-left evacuation before journal revision recovery. */
export function recoverExactPublication(
  path: string,
  token: string,
  allowedRevisions: readonly (ByteRevision | null)[],
  maxBytes: number,
): void {
  const parent = dirname(path);
  const evacuated = join(parent, `.${basename(path)}.${token}.repository-store.evacuated`);
  const temporary = join(parent, `.${basename(path)}.${token}.repository-store.tmp`);
  recoverTemporaryPublication(path, temporary, token, allowedRevisions, maxBytes);
  if (!artifactExists(evacuated)) return;
  const evidence = lstatSync(evacuated);
  if (evidence.isSymbolicLink() || !evidence.isFile())
    throw new RecoveryError('Evacuated publication evidence is unsafe.', 'RECOVERY_AMBIGUOUS', { path, evacuated });
  let current: Stats | undefined;
  try {
    current = lstatSync(path);
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  if (current === undefined) {
    restoreEvacuated(requireNativePublicationBackend(), evacuated, path, parent);
    return;
  }
  if (sameIdentity(evidence, current)) {
    // A crash can leave the exclusive publication hard link paired with its
    // package-owned evacuation name. Removing only the private name finalizes it.
    rmSync(evacuated);
    syncDirectory(parent);
    return;
  }
  assertSafeRegular(evidence, evacuated);
  assertSafeRegular(current, path);
  const evidenceRevision = computeByteRevision(readRegularFile(evacuated, maxBytes));
  const currentRevision = computeByteRevision(readRegularFile(path, maxBytes));
  if (!allowedRevisions.includes(evidenceRevision) || !allowedRevisions.includes(currentRevision))
    throw new RecoveryError('Canonical and evacuated states contain unauthenticated revisions.', 'RECOVERY_AMBIGUOUS', {
      path,
      evacuated,
      evidenceRevision,
      currentRevision,
    });
  publishExactRegularFile(
    evacuated,
    null,
    { identity: evidence, revision: evidenceRevision, maxBytes },
    `${token}-evidence`,
  );
}

function recoverTemporaryPublication(
  path: string,
  temporary: string,
  token: string,
  allowedRevisions: readonly (ByteRevision | null)[],
  maxBytes: number,
): void {
  if (!artifactExists(temporary)) return;
  const temporaryIdentity = lstatSync(temporary);
  let destination: Stats | undefined;
  try {
    destination = lstatSync(path);
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  if (destination !== undefined && sameIdentity(temporaryIdentity, destination)) {
    rmSync(temporary);
    syncDirectory(dirname(path));
    return;
  }
  assertSafeRegular(temporaryIdentity, temporary);
  const revision = computeByteRevision(readRegularFile(temporary, maxBytes));
  if (!allowedRevisions.includes(revision))
    throw new RecoveryError('Temporary publication artifact has an unauthenticated revision.', 'RECOVERY_AMBIGUOUS', {
      path,
      temporary,
      revision,
    });
  publishExactRegularFile(temporary, null, { identity: temporaryIdentity, revision, maxBytes }, `${token}-temporary`);
}

function restoreEvacuated(backend: NativePublicationBackend, evacuated: string, path: string, parent: string): void {
  try {
    nativeRenameNoReplace(backend, evacuated, path);
  } catch (error: unknown) {
    if (hasCode(error, 'EEXIST'))
      throw new RecoveryError(
        'Cannot restore raced destination because another entry appeared.',
        'RECOVERY_AMBIGUOUS',
        { path, evacuated },
      );
    throw nativeMoveError(error, path, 'restore destination');
  }
  syncDirectory(parent);
}

function moveNoReplace(
  backend: NativePublicationBackend,
  source: string,
  destination: string,
  operation: string,
): void {
  try {
    nativeRenameNoReplace(backend, source, destination);
  } catch (error: unknown) {
    if (hasCode(error, 'EEXIST'))
      throw new RecoveryError(`Cannot ${operation}; private destination already exists.`, 'RECOVERY_AMBIGUOUS', {
        source,
        destination,
      });
    if (hasCode(error, 'ENOENT'))
      throw new PathSafetyError(`Source disappeared while attempting to ${operation}: ${source}`, 'IDENTITY_CHANGED');
    throw nativeMoveError(error, source, operation);
  }
}

function nativeMoveError(error: unknown, path: string, operation: string): unknown {
  if (['EINVAL', 'EXDEV', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].some((code) => hasCode(error, code)))
    return new UnsupportedRuntimeError(`Filesystem cannot ${operation} without replacement: ${path}`);
  return error;
}

function unsupportedLink(error: unknown, path: string): unknown {
  if (['EPERM', 'EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].some((code) => hasCode(error, code)))
    return new UnsupportedRuntimeError(`Filesystem does not support exclusive regular-file publication: ${path}`);
  return error;
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
