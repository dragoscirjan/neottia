import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { PathSafetyError, RecoveryError, ResourceLimitError, StaleRevisionError } from '../errors.js';
import { assertPathAuthority, readManagedFileIfExists } from '../files.js';
import { emitTransactionFault } from '../internal/fault-injection.js';
import {
  assertSafeRegular,
  captureDirectories,
  ensurePrivateDirectory,
  hasCode,
  noFollowFlag,
  revalidateDirectories,
  sameIdentity,
  syncDirectory,
} from '../internal/filesystem.js';
import { PATH_STATE, ROOT_STATE, type ManagedPath, type ManagedRoot, type RepositoryLease } from '../internal/model.js';
import { assertLiveLease, checkControl, type OperationControl } from '../lease.js';
import { portablePathKey } from '../paths.js';
import { computeByteRevision, type ByteRevision } from '../revision.js';
import {
  cleanupJournal,
  createTransactionDirectory,
  manifestDigest,
  transactionRoot,
  writeDurableFile,
} from './journal.js';
import { recoverActiveDirectory } from './recovery.js';
import type { ApplyCanonicalBatchOptions, CanonicalOperation, JournalEntry, JournalManifest } from './types.js';

interface Transition {
  readonly path: ManagedPath;
  readonly original: Uint8Array | null;
  readonly intended: Uint8Array | null;
}

/** Applies an exact-revision batch using a durable rollback journal. */
export async function applyCanonicalBatch(
  root: ManagedRoot,
  lease: RepositoryLease,
  operations: readonly CanonicalOperation[],
  options: ApplyCanonicalBatchOptions = {},
): Promise<{ transactionId: string }> {
  assertLiveLease(root, lease);
  checkControl(options);
  // Snapshot caller-owned buffers before the first await so later mutation
  // cannot diverge staged, manifested, and published revisions.
  const ownedOperations = snapshotOperations(operations);
  const state = root[ROOT_STATE];
  if (ownedOperations.length === 0) return { transactionId: randomBytes(32).toString('hex') };
  if (ownedOperations.length > state.limits.maxBatchPaths)
    throw new ResourceLimitError('Canonical batch exceeds maxBatchPaths.');
  const transitions = await normalizeOperations(root, lease, ownedOperations, options);
  await validateProposedInventory(root, transitions, options.inventory);
  const transactionId = randomBytes(32).toString('hex');
  const transactions = transactionRoot(state.authorityRoot, state.managedRootId);
  const prepare = join(transactions, `${transactionId}.prepare`);
  const active = join(transactions, `${transactionId}.active`);
  const committed = join(transactions, `${transactionId}.committed`);
  createTransactionDirectory(prepare);
  syncDirectory(transactions);
  emitTransactionFault('prepare-directory-created');
  let stateDirectory = prepare;
  try {
    const entries: JournalEntry[] = [];
    let beforeBytes = 0;
    let temporaryBytes = 0;
    for (const [index, transition] of transitions.entries()) {
      checkControl(options);
      const beforeArtifact = transition.original === null ? null : `${index}-${transactionId}.before`;
      const stagedArtifact = transition.intended === null ? null : `${index}-${transactionId}.stage`;
      if (transition.original !== null) {
        beforeBytes += transition.original.byteLength;
        if (beforeBytes > state.limits.maxBeforeImageBytes)
          throw new ResourceLimitError('Canonical batch exceeds maxBeforeImageBytes.');
        writeDurableFile(join(prepare, beforeArtifact as string), transition.original);
        emitTransactionFault('before-image-written');
      }
      if (transition.intended !== null) {
        temporaryBytes += transition.intended.byteLength;
        if (temporaryBytes > state.limits.maxTemporaryBytes)
          throw new ResourceLimitError('Canonical batch exceeds maxTemporaryBytes.');
        writeDurableFile(join(prepare, stagedArtifact as string), transition.intended);
        emitTransactionFault('staged-artifact-written');
      }
      entries.push({
        path: transition.path.relativePath,
        originalRevision: transition.original === null ? null : computeByteRevision(transition.original),
        intendedRevision: transition.intended === null ? null : computeByteRevision(transition.intended),
        beforeArtifact,
        stagedArtifact,
        bytes: transition.intended?.byteLength ?? 0,
      });
    }
    const unsigned = {
      version: 1 as const,
      transactionId,
      authorityId: state.authorityId,
      managedRootId: state.managedRootId,
      entries,
      createdAt: new Date().toISOString(),
    };
    const manifest: JournalManifest = { ...unsigned, digest: manifestDigest(unsigned) };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
    if (manifestBytes.byteLength > state.limits.maxJournalBytes)
      throw new ResourceLimitError('Canonical transaction manifest exceeds maxJournalBytes.');
    writeDurableFile(join(prepare, 'manifest.json'), manifestBytes);
    emitTransactionFault('manifest-written');
    syncDirectory(prepare);
    emitTransactionFault('prepare-directory-synced');
    renameSync(prepare, active);
    stateDirectory = active;
    emitTransactionFault('active-state-renamed');
    syncDirectory(transactions);
    emitTransactionFault('active-state-synced');

    for (const transition of transitions) {
      checkControl(options);
      await verifyCurrent(root, lease, transition.path, transition.original, options);
      publishTransition(transition.path[PATH_STATE].absolutePath, transition.intended, transactionId);
      emitTransactionFault('canonical-path-published');
    }
    for (const transition of transitions)
      await verifyCurrent(root, lease, transition.path, transition.intended, options, true);
    renameSync(active, committed);
    stateDirectory = committed;
    emitTransactionFault('committed-state-renamed');
    syncDirectory(transactions);
    emitTransactionFault('committed-state-synced');
    try {
      const cleanup = join(transactions, `${transactionId}.cleanup`);
      renameSync(committed, cleanup);
      emitTransactionFault('cleanup-state-renamed');
      syncDirectory(transactions);
      emitTransactionFault('cleanup-state-synced');
      cleanupJournal(cleanup, manifest);
    } catch {
      // The committed marker is the durable commit point. Cleanup is retried
      // on the next lease and must never turn a committed batch into failure.
    }
    return { transactionId };
  } catch (error: unknown) {
    if (stateDirectory === active) {
      try {
        // Rollback is no longer cancellable once canonical publication began.
        await recoverActiveDirectory(root, lease, active, {});
      } catch (rollbackError: unknown) {
        throw new RecoveryError(
          'Canonical publication failed and durable rollback could not complete.',
          'RECOVERY_AMBIGUOUS',
          { transactionId },
          { cause: rollbackError },
        );
      }
    } else if (stateDirectory === prepare) {
      // This process created the exclusive token directory and publication has
      // not begun, so exact token artifacts can be removed even after a short write.
      try {
        removePreparationArtifacts(prepare, transactionId);
      } catch {
        // Preserve uncertain evidence; the primary pre-publication error wins.
      }
    }
    throw error;
  }
}

function snapshotOperations(operations: readonly CanonicalOperation[]): CanonicalOperation[] {
  return operations.map((operation) =>
    operation.kind === 'write' ? { ...operation, bytes: Uint8Array.from(operation.bytes) } : operation,
  );
}

async function normalizeOperations(
  root: ManagedRoot,
  lease: RepositoryLease,
  operations: readonly CanonicalOperation[],
  options: OperationControl,
): Promise<Transition[]> {
  const transitions = new Map<string, Transition>();
  const add = (transition: Transition): void => {
    assertPathAuthority(root, transition.path);
    const key = portablePathKey(transition.path.relativePath);
    if (transitions.has(key))
      throw new PathSafetyError('Canonical batch contains duplicate/colliding paths.', 'PATH_COLLISION');
    transitions.set(key, transition);
  };
  for (const operation of operations) {
    checkControl(options);
    if (operation.kind === 'write') {
      const current = await readManagedFileIfExists(root, lease, operation.path, options);
      assertExpected(operation.path, current?.revision, operation.expected);
      if (operation.bytes.byteLength > root[ROOT_STATE].limits.maxFileBytes)
        throw new ResourceLimitError(`Canonical file exceeds maxFileBytes: ${operation.path.relativePath}`);
      add({ path: operation.path, original: current?.bytes ?? null, intended: operation.bytes });
    } else if (operation.kind === 'remove') {
      const current = await readManagedFileIfExists(root, lease, operation.path, options);
      assertExpected(operation.path, current?.revision, operation.expected);
      add({ path: operation.path, original: current?.bytes ?? null, intended: null });
    } else {
      if (operation.from.relativePath === operation.to.relativePath)
        throw new PathSafetyError('Canonical move source and destination must differ.');
      const source = await readManagedFileIfExists(root, lease, operation.from, options);
      const destination = await readManagedFileIfExists(root, lease, operation.to, options);
      assertExpected(operation.from, source?.revision, operation.expectedSource);
      assertExpected(operation.to, destination?.revision, operation.expectedDestination);
      add({ path: operation.from, original: source?.bytes ?? null, intended: null });
      add({ path: operation.to, original: destination?.bytes ?? null, intended: source?.bytes ?? null });
    }
  }
  return [...transitions.values()].sort((left, right) => left.path.relativePath.localeCompare(right.path.relativePath));
}

function assertExpected(path: ManagedPath, actual: ByteRevision | undefined, expected: 'absent' | ByteRevision): void {
  if ((expected === 'absent' && actual === undefined) || expected === actual) return;
  throw new StaleRevisionError(`Canonical revision mismatch: ${path.relativePath}`, { expected, actual });
}

async function validateProposedInventory(
  root: ManagedRoot,
  transitions: readonly Transition[],
  inventoryRoots: readonly ManagedPath[] | undefined,
): Promise<void> {
  const state = root[ROOT_STATE];
  const inventory = new Map<string, { path: string; bytes: number }>();
  if (inventoryRoots === undefined) {
    inventoryWalk(state.managedRoot, state.managedRoot, inventory, state.authorityRoot === state.managedRoot);
  } else {
    for (const inventoryRoot of inventoryRoots) {
      assertPathAuthority(root, inventoryRoot);
      inventoryWalk(inventoryRoot[PATH_STATE].absolutePath, state.managedRoot, inventory, false);
    }
  }
  for (const transition of transitions) {
    const key = portablePathKey(transition.path.relativePath);
    const existing = inventory.get(key);
    if (existing !== undefined && existing.path !== transition.path.relativePath)
      throw new PathSafetyError(
        `Portable catalog collision: ${existing.path} and ${transition.path.relativePath}`,
        'PATH_COLLISION',
      );
    inventory.delete(key);
    if (transition.intended !== null)
      inventory.set(key, { path: transition.path.relativePath, bytes: transition.intended.byteLength });
  }
  const values = [...inventory.values()];
  const paths = new Set<string>();
  for (const item of values) {
    const key = portablePathKey(item.path);
    if (paths.has(key)) throw new PathSafetyError(`Portable catalog collision: ${item.path}`, 'PATH_COLLISION');
    paths.add(key);
  }
  if (values.length > state.limits.maxFiles)
    throw new ResourceLimitError('Resulting canonical file count exceeds limit.');
  if (values.reduce((sum, item) => sum + item.bytes, 0) > state.limits.maxTotalBytes)
    throw new ResourceLimitError('Resulting canonical byte count exceeds limit.');
}

function inventoryWalk(
  absolute: string,
  root: string,
  output: Map<string, { path: string; bytes: number }>,
  skipControl: boolean,
): void {
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(absolute, entry.name);
    const relativePath = relative(root, path).split('\\').join('/');
    if (skipControl && relativePath === '.neottia/repository-store') continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new PathSafetyError(`Symbolic link in managed catalog: ${path}`, 'UNSAFE_LINK');
    if (stat.isDirectory()) {
      inventoryWalk(path, root, output, skipControl);
      continue;
    }
    assertSafeRegular(stat, path);
    const key = portablePathKey(relativePath);
    const previous = output.get(key);
    if (previous !== undefined && previous.path !== relativePath)
      throw new PathSafetyError(`Portable catalog collision: ${previous.path} and ${relativePath}`, 'PATH_COLLISION');
    output.set(key, { path: relativePath, bytes: stat.size });
  }
}

async function verifyCurrent(
  root: ManagedRoot,
  lease: RepositoryLease,
  path: ManagedPath,
  expected: Uint8Array | null,
  options: OperationControl,
  recoveryVerification = false,
): Promise<void> {
  const current = await readManagedFileIfExists(root, lease, path, options);
  const actualRevision = current?.revision;
  const expectedRevision = expected === null ? undefined : computeByteRevision(expected);
  if (actualRevision !== expectedRevision) {
    if (recoveryVerification)
      throw new RecoveryError('Published canonical revision does not match intended bytes.', 'RECOVERY_AMBIGUOUS', {
        path: path.relativePath,
      });
    throw new StaleRevisionError(`Canonical path changed during publication: ${path.relativePath}`);
  }
}

/** Publishes one transition using a same-directory durable temporary file. */
export function publishTransition(path: string, bytes: Uint8Array | null, token: string): void {
  const parent = dirname(path);
  ensurePrivateDirectory(parent);
  const parents = captureDirectories(parent);
  if (bytes === null) {
    const stat = lstatSync(path);
    assertSafeRegular(stat, path);
    revalidateDirectories(parents);
    rmSync(path);
    revalidateDirectories(parents);
    syncDirectory(parent);
    return;
  }
  const temporary = join(parent, `.${token}.repository-store.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollowFlag(),
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const temporaryStat = fstatSync(descriptor);
    assertSafeRegular(temporaryStat, temporary);
    closeSync(descriptor);
    descriptor = undefined;
    if (exists(path)) assertSafeRegular(lstatSync(path), path);
    revalidateDirectories(parents);
    renameSync(temporary, path);
    const destination = lstatSync(path);
    if (!sameIdentity(temporaryStat, destination))
      throw new PathSafetyError(`Destination changed during publication: ${path}`, 'IDENTITY_CHANGED');
    revalidateDirectories(parents);
    syncDirectory(parent);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      revalidateDirectories(parents);
      if (exists(temporary)) rmSync(temporary);
    } catch {
      // Never clean through a rebound parent.
    }
  }
}

function removePreparationArtifacts(directory: string, token: string): void {
  const entries = readdirSync(directory);
  for (const entry of entries) {
    if (entry !== 'manifest.json' && !new RegExp(`^[0-9]+-${token}\\.(?:before|stage)$`, 'u').test(entry)) return;
    assertSafeRegular(lstatSync(join(directory, entry)), join(directory, entry));
  }
  for (const entry of entries) rmSync(join(directory, entry));
  rmdirSync(directory);
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}
