import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { RecoveryError, ResourceLimitError } from '../errors.js';
import { emitTransactionFault } from '../internal/fault-injection.js';
import { assertSafeRegular, ensurePrivateDirectory, readRegularFile, syncDirectory } from '../internal/filesystem.js';
import { isByteRevision } from '../revision.js';
import type { JournalEntry, JournalManifest } from './types.js';

/** Returns the private control directory containing transaction states. */
export function transactionRoot(authorityRoot: string, managedRootId: string): string {
  if (!/^[0-9a-f]{64}$/u.test(managedRootId)) throw malformed('Managed-root transaction identity is invalid.');
  const path = join(authorityRoot, '.neottia', 'repository-store', 'transactions', managedRootId);
  ensurePrivateDirectory(path);
  return path;
}

/** Writes one private artifact and synchronizes its bytes. */
export function writeDurableFile(path: string, bytes: Uint8Array): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Builds a digest over the manifest fields other than the digest itself. */
export function manifestDigest(manifest: Omit<JournalManifest, 'digest'>): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

/** Reads and strictly validates bounded transaction evidence. */
export function readManifest(directory: string, maxJournalBytes: number): JournalManifest {
  const path = join(directory, 'manifest.json');
  const stat = lstatSync(path);
  assertSafeRegular(stat, path);
  if (stat.size > maxJournalBytes) throw malformed('Transaction manifest exceeds maxJournalBytes.');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(readRegularFile(path, maxJournalBytes)));
  } catch (error: unknown) {
    throw malformed('Transaction manifest is not valid JSON.', error);
  }
  if (!isManifest(value)) throw malformed('Transaction manifest has an invalid schema.');
  const { digest, ...unsigned } = value;
  if (manifestDigest(unsigned) !== digest) throw malformed('Transaction manifest digest does not match.');
  const sorted = [...value.entries].sort((left, right) => left.path.localeCompare(right.path));
  if (sorted.some((entry, index) => entry.path !== value.entries[index]?.path))
    throw malformed('Transaction manifest entries are not canonically sorted.');
  return value;
}

/** Removes only exact artifacts authenticated by a validated manifest. */
export function cleanupJournal(directory: string, manifest: JournalManifest): void {
  const expected = new Set<string>(['manifest.json']);
  for (const entry of manifest.entries)
    for (const artifact of [entry.beforeArtifact, entry.stagedArtifact]) if (artifact !== null) expected.add(artifact);
  const actual = readdirSync(directory);
  if (actual.some((name) => !expected.has(name))) throw malformed('Transaction directory contains unowned artifacts.');
  for (const entry of manifest.entries) {
    for (const artifact of [entry.beforeArtifact, entry.stagedArtifact]) {
      if (artifact === null) continue;
      assertArtifactName(artifact, manifest.transactionId);
      const path = join(directory, artifact);
      try {
        const stat = lstatSync(path);
        assertSafeRegular(stat, path);
        rmSync(path);
        emitTransactionFault('cleanup-artifact-removed');
      } catch (error: unknown) {
        if (!isMissing(error)) throw error;
      }
    }
  }
  removeRegularIfPresent(join(directory, 'manifest.json'));
  emitTransactionFault('cleanup-manifest-removed');
  rmdirSync(directory);
  emitTransactionFault('cleanup-directory-removed');
  syncDirectory(join(directory, '..'));
  emitTransactionFault('cleanup-root-synced');
}

/** Safely removes an incomplete prepare/cleanup state using its random token. */
export function cleanupIncompleteJournal(
  directory: string,
  transactionId: string,
  limits: { readonly maxJournalBytes: number; readonly maxArtifactBytes: number },
): void {
  const entries = readdirSync(directory);
  for (const entry of entries) {
    const path = join(directory, entry);
    const stat = lstatSync(path);
    assertSafeRegular(stat, path);
    if (entry === 'manifest.json') {
      if (stat.size > limits.maxJournalBytes) throw malformed('Incomplete transaction manifest exceeds its bound.');
    } else {
      assertArtifactName(entry, transactionId);
      if (stat.size > limits.maxArtifactBytes) throw malformed('Incomplete transaction artifact exceeds its bound.');
    }
  }
  for (const entry of entries.filter((name) => name !== 'manifest.json')) {
    rmSync(join(directory, entry));
    emitTransactionFault('cleanup-artifact-removed');
  }
  removeRegularIfPresent(join(directory, 'manifest.json'));
  emitTransactionFault('cleanup-manifest-removed');
  rmdirSync(directory);
  emitTransactionFault('cleanup-directory-removed');
  syncDirectory(join(directory, '..'));
  emitTransactionFault('cleanup-root-synced');
}

/** Ensures every referenced artifact is exact, safe, and revision-verifiable. */
export function validateArtifacts(
  directory: string,
  manifest: JournalManifest,
  limits: { readonly maxBeforeImageBytes: number; readonly maxTemporaryBytes: number },
): void {
  let beforeBytes = 0;
  let stagedBytes = 0;
  for (const entry of manifest.entries) {
    if (entry.beforeArtifact !== null) {
      assertArtifactName(entry.beforeArtifact, manifest.transactionId);
      const bytes = readArtifact(directory, entry.beforeArtifact, limits.maxBeforeImageBytes);
      beforeBytes += bytes.byteLength;
      if (revision(bytes) !== entry.originalRevision) throw malformed('Before-image revision does not match manifest.');
    }
    if (entry.stagedArtifact !== null) {
      assertArtifactName(entry.stagedArtifact, manifest.transactionId);
      const bytes = readArtifact(directory, entry.stagedArtifact, limits.maxTemporaryBytes);
      stagedBytes += bytes.byteLength;
      if (revision(bytes) !== entry.intendedRevision) throw malformed('Staged revision does not match manifest.');
    }
  }
  if (beforeBytes > limits.maxBeforeImageBytes)
    throw new ResourceLimitError('Transaction before-images exceed configured bound.');
  if (stagedBytes > limits.maxTemporaryBytes)
    throw new ResourceLimitError('Transaction staged artifacts exceed configured bound.');
}

/** Reads one transaction-owned artifact after exact name validation. */
export function readArtifact(directory: string, name: string, maxBytes: number): Uint8Array {
  assertArtifactName(name, directory.split(/[\\/]/u).at(-1)?.split('.')[0] ?? '');
  const path = join(directory, name);
  return readRegularFile(path, maxBytes);
}

/** Creates a private transaction state directory. */
export function createTransactionDirectory(path: string): void {
  mkdirSync(path, { mode: 0o700 });
}

function isManifest(value: unknown): value is JournalManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<JournalManifest>;
  if (
    candidate.version !== 1 ||
    typeof candidate.transactionId !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(candidate.transactionId) ||
    typeof candidate.authorityId !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(candidate.authorityId) ||
    typeof candidate.managedRootId !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(candidate.managedRootId) ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.digest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(candidate.digest) ||
    !Array.isArray(candidate.entries)
  )
    return false;
  const paths = new Set<string>();
  for (const entry of candidate.entries) {
    if (!isEntry(entry) || paths.has(entry.path)) return false;
    paths.add(entry.path);
  }
  return true;
}

function isEntry(value: unknown): value is JournalEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<JournalEntry>;
  return (
    typeof entry.path === 'string' &&
    (entry.originalRevision === null || isByteRevision(entry.originalRevision)) &&
    (entry.intendedRevision === null || isByteRevision(entry.intendedRevision)) &&
    (entry.beforeArtifact === null || typeof entry.beforeArtifact === 'string') &&
    (entry.stagedArtifact === null || typeof entry.stagedArtifact === 'string') &&
    Number.isSafeInteger(entry.bytes) &&
    (entry.bytes ?? -1) >= 0
  );
}

function assertArtifactName(name: string, token: string): void {
  if (!new RegExp(`^[0-9]+-${token}\\.(?:before|stage)$`, 'u').test(name))
    throw malformed(`Unowned transaction artifact name: ${name}`);
}

function revision(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function malformed(message: string, cause?: unknown): RecoveryError {
  return new RecoveryError(message, 'RECOVERY_MALFORMED', undefined, cause === undefined ? undefined : { cause });
}

function removeRegularIfPresent(path: string): void {
  try {
    const stat = lstatSync(path);
    assertSafeRegular(stat, path);
    rmSync(path);
  } catch (error: unknown) {
    if (!isMissing(error)) throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
