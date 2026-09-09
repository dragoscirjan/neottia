import { lstatSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RecoveryError } from '../errors.js';
import { readManagedFileIfExists } from '../files.js';
import { emitTransactionFault } from '../internal/fault-injection.js';
import { syncDirectory } from '../internal/filesystem.js';
import { PATH_STATE, ROOT_STATE, type ManagedRoot, type RepositoryLease } from '../internal/model.js';
import { assertLiveLease, checkControl, type OperationControl } from '../lease.js';
import { resolveManagedPath, validateRelativePath } from '../paths.js';
import { publishTransition } from './apply.js';
import {
  cleanupIncompleteJournal,
  cleanupJournal,
  readArtifact,
  readManifest,
  transactionRoot,
  validateArtifacts,
} from './journal.js';
import type { JournalManifest, RecoveryReport } from './types.js';

const STATE_NAME = /^([0-9a-f]{64})\.(prepare|active|committed|cleanup)$/u;

/** Recovers all exact package-owned journals before an authority operation. */
export async function recoverCanonicalTransactions(
  root: ManagedRoot,
  lease: RepositoryLease,
  options: OperationControl = {},
): Promise<RecoveryReport> {
  assertLiveLease(root, lease);
  checkControl(options);
  const state = root[ROOT_STATE];
  const transactions = transactionRoot(state.authorityRoot, state.managedRootId);
  const report = { rolledBack: [] as string[], cleanedPrepared: [] as string[], cleanedCommitted: [] as string[] };
  for (const name of readdirSync(transactions).sort()) {
    checkControl(options);
    const match = STATE_NAME.exec(name);
    if (match === null) continue;
    const transactionId = match[1] as string;
    const phase = match[2] as 'prepare' | 'active' | 'committed' | 'cleanup';
    const directory = join(transactions, name);
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw malformed(`Unsafe transaction state path: ${directory}`);
    if (phase === 'prepare' || phase === 'cleanup') {
      // Neither state can require canonical publication: prepare precedes it,
      // while cleanup is entered only after commit or verified rollback.
      cleanupIncompleteJournal(directory, transactionId, {
        maxJournalBytes: state.limits.maxJournalBytes,
        maxArtifactBytes: Math.max(state.limits.maxBeforeImageBytes, state.limits.maxTemporaryBytes),
      });
      if (phase === 'prepare') report.cleanedPrepared.push(transactionId);
      else report.cleanedCommitted.push(transactionId);
      continue;
    }
    const manifest = readAndValidateManifest(root, directory, transactionId);
    if (phase === 'active') {
      await recoverActiveDirectory(root, lease, directory, options);
      report.rolledBack.push(manifest.transactionId);
    } else {
      const cleanup = transitionToCleanup(directory, transactionId);
      cleanupJournal(cleanup, manifest);
      report.cleanedCommitted.push(manifest.transactionId);
    }
  }
  return report;
}

/** Rolls one validated active journal back to its exact original state. */
export async function recoverActiveDirectory(
  root: ManagedRoot,
  lease: RepositoryLease,
  directory: string,
  options: OperationControl,
): Promise<void> {
  const state = root[ROOT_STATE];
  const transactionId = directory.split(/[\\/]/u).at(-1)?.split('.')[0];
  if (transactionId === undefined) throw malformed('Active transaction path has no identity.');
  const manifest = readAndValidateManifest(root, directory, transactionId);
  for (const entry of [...manifest.entries].reverse()) {
    checkControl(options);
    const path = resolveManagedPath(root, entry.path);
    const current = await readManagedFileIfExists(root, lease, path, options);
    const revision = current?.revision ?? null;
    if (revision === entry.originalRevision) continue;
    if (revision !== entry.intendedRevision)
      throw new RecoveryError('Canonical state differs from both journal revisions.', 'RECOVERY_AMBIGUOUS', {
        transactionId: manifest.transactionId,
        path: entry.path,
        currentRevision: revision,
        originalRevision: entry.originalRevision,
        intendedRevision: entry.intendedRevision,
      });
    const original =
      entry.beforeArtifact === null
        ? null
        : readArtifact(directory, entry.beforeArtifact, state.limits.maxBeforeImageBytes);
    publishTransition(path[PATH_STATE].absolutePath, original, manifest.transactionId);
  }
  for (const entry of manifest.entries) {
    const path = resolveManagedPath(root, entry.path);
    const current = await readManagedFileIfExists(root, lease, path, options);
    if ((current?.revision ?? null) !== entry.originalRevision)
      throw new RecoveryError('Rollback verification did not restore original revision.', 'RECOVERY_AMBIGUOUS', {
        transactionId: manifest.transactionId,
        path: entry.path,
      });
  }
  const cleanup = transitionToCleanup(directory, manifest.transactionId);
  cleanupJournal(cleanup, manifest);
}

function readAndValidateManifest(root: ManagedRoot, directory: string, transactionId: string): JournalManifest {
  const state = root[ROOT_STATE];
  const manifest = readManifest(directory, state.limits.maxJournalBytes);
  if (
    manifest.transactionId !== transactionId ||
    manifest.authorityId !== state.authorityId ||
    manifest.managedRootId !== state.managedRootId
  )
    throw malformed('Transaction identity does not match its authority, managed root, or directory name.');
  for (const entry of manifest.entries) validateRelativePath(entry.path);
  validateArtifacts(directory, manifest, {
    maxBeforeImageBytes: state.limits.maxBeforeImageBytes,
    maxTemporaryBytes: state.limits.maxTemporaryBytes,
  });
  return manifest;
}

function transitionToCleanup(directory: string, transactionId: string): string {
  const cleanup = join(dirname(directory), `${transactionId}.cleanup`);
  renameSync(directory, cleanup);
  emitTransactionFault('cleanup-state-renamed');
  syncDirectory(dirname(directory));
  emitTransactionFault('cleanup-state-synced');
  return cleanup;
}

function malformed(message: string): RecoveryError {
  return new RecoveryError(message, 'RECOVERY_MALFORMED');
}
