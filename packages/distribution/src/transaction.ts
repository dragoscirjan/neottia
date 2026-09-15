import { randomUUID } from 'node:crypto';
import { open, lstat, mkdir, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import { canonicalJson, checksumBytes, journalPath } from './manifest.js';
import { assertPlanAuthorized, validatePlan } from './planner.js';
import type {
  ApplyOptions,
  ApplyResult,
  ExpectedFile,
  InstallationPlan,
  PlanMutation,
  TransactionJournal,
} from './types.js';

/** Applies one authorized plan under a lock with durable before-images. */
export async function applyInstallationPlan(plan: InstallationPlan, options: ApplyOptions = {}): Promise<ApplyResult> {
  assertPlanAuthorized(plan);
  await assertSafePath(plan.receiptPath, plan.receiptRoot);
  const release = await acquireLock(plan.receiptPath);
  const transactionPath = journalPath(plan.receiptPath);
  try {
    if (await exists(transactionPath)) throw new TypeError('A pending installer transaction must be recovered first.');
    const journal = await createJournal(plan);
    await writeAtomic(transactionPath, Buffer.from(canonicalJson(journal), 'utf8'));
    const applied: string[] = [];
    try {
      for (const [index, mutation] of plan.mutations.entries()) {
        await options.beforeMutation?.(index, mutation);
        await assertSafePath(mutation.path, mutation.root);
        await assertExpected(mutation.path, mutation.before);
        await applyMutation(mutation);
        applied.push(mutation.id);
      }
      const committed: TransactionJournal = { ...journal, state: 'committed' };
      await writeAtomic(transactionPath, Buffer.from(canonicalJson(committed), 'utf8'));
      await removeFile(transactionPath);
      return Object.freeze({
        planId: plan.id,
        appliedMutations: Object.freeze(applied),
        ...(plan.reloadNotice === undefined ? {} : { reloadNotice: plan.reloadNotice }),
      });
    } catch (error) {
      try {
        await rollbackJournal(journal);
        await removeFile(transactionPath);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Installation failed and rollback requires recovery.');
      }
      throw error;
    }
  } finally {
    await release();
  }
}

/** Recovers an active transaction or removes a committed cleanup journal. */
export async function recoverInstallation(receiptPathValue: string): Promise<'rolled-back' | 'cleaned-up' | 'none'> {
  await assertSafePath(receiptPathValue, dirname(receiptPathValue));
  const release = await acquireLock(receiptPathValue);
  const transactionPath = journalPath(receiptPathValue);
  try {
    if (!(await exists(transactionPath))) return 'none';
    const journal = JSON.parse(await readFile(transactionPath, 'utf8')) as TransactionJournal;
    validateJournal(journal);
    if (journal.state === 'committed') {
      await removeFile(transactionPath);
      return 'cleaned-up';
    }
    await rollbackJournal(journal);
    await removeFile(transactionPath);
    return 'rolled-back';
  } finally {
    await release();
  }
}

/** Verifies a serialized plan without applying it. */
export function decodeInstallationPlan(value: unknown): InstallationPlan {
  const plan = value as InstallationPlan;
  validatePlan(plan);
  return plan;
}

/** Captures every before-image after verifying all plan preconditions. */
async function createJournal(plan: InstallationPlan): Promise<TransactionJournal> {
  validatePlan(plan);
  const entries: TransactionJournal['entries'][number][] = [];
  for (const mutation of plan.mutations) {
    await assertSafePath(mutation.path, mutation.root);
    const current = await readExactFile(mutation.path);
    assertState(current, mutation.before, mutation.path);
    entries.push({
      path: mutation.path,
      root: mutation.root,
      before: current.exists
        ? { exists: true, encoding: 'base64', content: current.bytes!.toString('base64'), checksum: current.checksum! }
        : { exists: false },
      after: mutation.kind === 'write-file' ? { exists: true, checksum: mutation.checksum } : { exists: false },
    });
  }
  return Object.freeze({ schemaVersion: 1, planDigest: plan.digest, state: 'active', entries: Object.freeze(entries) });
}

/** Restores before-images only when current state is expected or already restored. */
async function rollbackJournal(journal: TransactionJournal): Promise<void> {
  for (const entry of [...journal.entries].reverse()) {
    await assertSafePath(entry.path, entry.root);
    const current = await readExactFile(entry.path);
    if (matches(current, entry.before)) continue;
    if (!matches(current, entry.after)) {
      throw new TypeError(`Cannot recover ${entry.path} because it changed outside the transaction.`);
    }
    if (entry.before.exists) await writeAtomic(entry.path, Buffer.from(entry.before.content, 'base64'));
    else await removeFile(entry.path);
  }
}

/** Applies one exact file operation. */
async function applyMutation(mutation: PlanMutation): Promise<void> {
  if (mutation.kind === 'remove-file') {
    await removeFile(mutation.path);
    return;
  }
  await writeAtomic(mutation.path, Buffer.from(mutation.content, mutation.encoding));
  await assertExpected(mutation.path, { exists: true, checksum: mutation.checksum });
}

/** Publishes bytes through a same-directory temporary file and synchronizes the directory. */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.neottia-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    await syncDirectory(directory);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Removes one file and synchronizes its containing directory. */
async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
    await syncDirectory(dirname(path));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

/** Reads one regular file without following links. */
async function readExactFile(
  path: string,
): Promise<{ exists: boolean; bytes?: Buffer; checksum?: ReturnType<typeof checksumBytes> }> {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return { exists: false };
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new TypeError(`Installer target is not a regular file: ${path}`);
  const bytes = await readFile(path);
  return { exists: true, bytes, checksum: checksumBytes(bytes) };
}

/** Rejects lexical escapes and symbolic-link ancestors before mutation. */
async function assertSafePath(path: string, root: string): Promise<void> {
  if (!isAbsolute(path) || !isAbsolute(root)) throw new TypeError('Mutation path and root must be absolute.');
  const relation = relative(root, path);
  if (relation === '' || relation.startsWith('..') || isAbsolute(relation)) {
    throw new TypeError(`Mutation path escapes its approved root: ${path}`);
  }
  let current = root;
  const parentSegments = relation.split(sep).slice(0, -1);
  for (const segment of ['', ...parentSegments]) {
    if (segment !== '') current = join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new TypeError(`Mutation path has an unsafe ancestor: ${current}`);
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

/** Checks one optimistic before-state. */
async function assertExpected(path: string, expected: ExpectedFile): Promise<void> {
  assertState(await readExactFile(path), expected, path);
}

/** Compares a current file against an expected state. */
function assertState(
  current: { readonly exists: boolean; readonly checksum?: ReturnType<typeof checksumBytes> },
  expected: ExpectedFile,
  path: string,
): void {
  if (!matches(current, expected)) throw new TypeError(`Installation plan is stale for ${path}.`);
}

/** Tests exact absence or exact bytes. */
function matches(
  current: { readonly exists: boolean; readonly checksum?: ReturnType<typeof checksumBytes> },
  expected: ExpectedFile,
): boolean {
  return current.exists === expected.exists && (!expected.exists || current.checksum === expected.checksum);
}

/** Uses a PID lock and reclaims only conclusively dead local owners. */
async function acquireLock(receiptPathValue: string): Promise<() => Promise<void>> {
  const path = `${receiptPathValue}.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`);
      await handle.sync();
      await handle.close();
      return async () => removeFile(path);
    } catch (error) {
      if (!isExists(error)) throw error;
      const owner = Number.parseInt(await readFile(path, 'utf8'), 10);
      if (!Number.isInteger(owner) || processAlive(owner))
        throw new TypeError('Another installer process holds the installation lock.');
      await removeFile(path);
    }
  }
  throw new TypeError('Could not acquire the installation lock.');
}

/** Checks a same-host PID without terminating it. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

/** Synchronizes directory metadata where the platform supports it. */
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && ['EINVAL', 'ENOTSUP'].includes(String(error.code)))) throw error;
  } finally {
    await handle.close();
  }
}

/** Validates the bounded journal envelope before recovery. */
function validateJournal(journal: TransactionJournal): void {
  if (
    journal.schemaVersion !== 1 ||
    !['active', 'committed'].includes(journal.state) ||
    !Array.isArray(journal.entries)
  ) {
    throw new TypeError('Transaction journal is invalid.');
  }
  for (const entry of journal.entries) {
    if (!isAbsolute(entry.path) || !isAbsolute(entry.root)) throw new TypeError('Transaction journal path is invalid.');
    const relation = relative(entry.root, entry.path);
    if (relation === '' || relation.startsWith('..') || isAbsolute(relation)) {
      throw new TypeError('Transaction journal path is outside its root.');
    }
    if (entry.before.exists && checksumBytes(Buffer.from(entry.before.content, 'base64')) !== entry.before.checksum) {
      throw new TypeError('Transaction journal before-image checksum does not match.');
    }
  }
}

/** Checks path presence without hiding permission errors. */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Narrows missing-path errors. */
function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Narrows exclusive-create collisions. */
function isExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
