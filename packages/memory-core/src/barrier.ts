import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MemoryLockError } from './errors.js';

/**
 * Shard-scoped cross-process lock (neottia#1 decision #2): one lock directory
 * per namespace shard under the memory root. Acquisition uses atomic mkdir;
 * a lock is stolen only when it is stale AND its writer is provably gone, so
 * a live-but-slow writer on the same host is never interrupted mid-operation.
 */

export interface ShardBarrierOptions {
  waitMs?: number;
  staleMs?: number;
  pollMs?: number;
}

export interface ShardLease {
  readonly lockPath: string;
}

const DEFAULT_WAIT_MS = 10_000;
const DEFAULT_STALE_MS = 60_000;
const DEFAULT_POLL_MS = 20;
const MAX_WAIT_MS = 60_000;

const activeLocks = new Set<string>();

interface AcquiredLock {
  readonly lease: ShardLease;
  readonly release: () => void;
}

function acquire(memoryRoot: string, scopeKey: string, options: ShardBarrierOptions): AcquiredLock {
  const { lockPath, waitMs, staleMs, pollMs } = prepareAcquire(memoryRoot, scopeKey, options);
  const lockDirectory = dirname(lockPath);
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  assertSafeDirectory(lockDirectory);

  if (activeLocks.has(lockPath)) throw new MemoryLockError(`Shard barrier is non-reentrant: ${scopeKey}`);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      if (hasActiveClaim(lockPath, staleMs)) {
        rmSync(lockPath, { recursive: true, force: true });
        sleep(pollMs);
        continue;
      }
      break;
    } catch (error: unknown) {
      if (!isCode(error, 'EEXIST')) throw new MemoryLockError(`Cannot acquire shard barrier: ${scopeKey}`);
      if (claimAbandoned(lockPath, staleMs)) continue;
      if (hasActiveClaim(lockPath, staleMs)) {
        if (Date.now() >= deadline) throw new MemoryLockError(`Shard barrier is busy: ${scopeKey}`);
        sleep(pollMs);
        continue;
      }
      if (Date.now() >= deadline) throw new MemoryLockError(`Shard barrier is busy: ${scopeKey}`);
      sleep(pollMs);
    }
  }

  return finishAcquire(lockPath, scopeKey);
}

/**
 * Runs `operation` while holding the exclusive lock for one memory shard.
 * Promise-returning callbacks must use withShardBarrierAsync instead.
 */
export function withShardBarrier<T>(
  memoryRoot: string,
  scopeKey: string,
  operation: (lease: ShardLease) => T extends PromiseLike<unknown> ? never : T,
  options: ShardBarrierOptions = {},
): T {
  const { lease, release } = acquire(memoryRoot, scopeKey, options);
  try {
    return operation(lease) as T;
  } finally {
    release();
  }
}

/**
 * Async variant for operations that await; the lock is held across awaits
 * and released when the promise settles.
 */
export async function withShardBarrierAsync<T>(
  memoryRoot: string,
  scopeKey: string,
  operation: (lease: ShardLease) => Promise<T>,
  options: ShardBarrierOptions = {},
): Promise<T> {
  const { lease, release } = await acquireAsync(memoryRoot, scopeKey, options);
  try {
    return await operation(lease);
  } finally {
    release();
  }
}

async function acquireAsync(memoryRoot: string, scopeKey: string, options: ShardBarrierOptions): Promise<AcquiredLock> {
  const { lockPath, waitMs, staleMs, pollMs } = prepareAcquire(memoryRoot, scopeKey, options);
  const lockDirectory = dirname(lockPath);
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  assertSafeDirectory(lockDirectory);
  if (activeLocks.has(lockPath)) throw new MemoryLockError(`Shard barrier is non-reentrant: ${scopeKey}`);

  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      if (hasActiveClaim(lockPath, staleMs)) {
        rmSync(lockPath, { recursive: true, force: true });
        await delay(pollMs);
        continue;
      }
      break;
    } catch (error: unknown) {
      if (!isCode(error, 'EEXIST')) throw new MemoryLockError(`Cannot acquire shard barrier: ${scopeKey}`);
      if (claimAbandoned(lockPath, staleMs)) continue;
      if (hasActiveClaim(lockPath, staleMs)) {
        if (Date.now() >= deadline) throw new MemoryLockError(`Shard barrier is busy: ${scopeKey}`);
        await delay(pollMs);
        continue;
      }
      if (Date.now() >= deadline) throw new MemoryLockError(`Shard barrier is busy: ${scopeKey}`);
      await delay(pollMs);
    }
  }

  return finishAcquire(lockPath, scopeKey);
}

/** Stale AND provably ownerless: mtime aged out and the PID is not alive. */
function prepareAcquire(
  memoryRoot: string,
  scopeKey: string,
  options: ShardBarrierOptions,
): { lockPath: string; waitMs: number; staleMs: number; pollMs: number } {
  const waitMs = clampInteger(options.waitMs ?? DEFAULT_WAIT_MS, 0, MAX_WAIT_MS, 'waitMs');
  const staleMs = clampInteger(options.staleMs ?? DEFAULT_STALE_MS, 1, Number.MAX_SAFE_INTEGER, 'staleMs');
  const pollMs = clampInteger(options.pollMs ?? DEFAULT_POLL_MS, 1, 1_000, 'pollMs');
  const root = resolve(memoryRoot);
  assertSafeDirectory(root);
  const lockPath = resolve(join(root, '.locks'), `${sanitizeLockName(scopeKey)}.lock`);
  return { lockPath, waitMs, staleMs, pollMs };
}

function finishAcquire(lockPath: string, scopeKey: string): AcquiredLock {
  activeLocks.add(lockPath);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    activeLocks.delete(lockPath);
    try {
      rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // Fail closed: a release failure intentionally leaves the lock behind
      // so the next acquirer can detect and steal it once stale.
    }
  };
  try {
    writeFileSync(join(lockPath, 'owner'), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), {
      mode: 0o600,
    });
    return { lease: { lockPath }, release };
  } catch (error: unknown) {
    release();
    throw new MemoryLockError(`Cannot initialize shard barrier: ${scopeKey}`);
  }
}

function assertSafeDirectory(path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new MemoryLockError(`Unsafe shard barrier directory: ${path}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/** Atomically claims and removes a stale lock directory without a TOCTOU delete. */
function claimAbandoned(lockPath: string, staleMs: number): boolean {
  const claimPath = `${lockPath}.claim`;
  const token = `${process.pid}-${randomUUID()}`;
  try {
    mkdirSync(claimPath, { mode: 0o700 });
    writeFileSync(join(claimPath, 'owner'), JSON.stringify({ pid: process.pid, token }), { mode: 0o600 });
  } catch (error: unknown) {
    if (!isCode(error, 'EEXIST')) throw error;
    return false;
  }
  try {
    // The claim directory blocks new owners while the stale owner is checked
    // and removed. Its live owner is never removed by age alone.
    if (!isAbandoned(lockPath, staleMs)) return false;
    rmSync(lockPath, { recursive: true, force: true });
    return true;
  } finally {
    if (claimOwnerMatches(claimPath, token)) rmSync(claimPath, { recursive: true, force: true });
  }
}

function hasActiveClaim(lockPath: string, _staleMs: number): boolean {
  const claimPath = `${lockPath}.claim`;
  if (!existsSync(claimPath)) return false;
  try {
    const stats = lstatSync(claimPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new MemoryLockError(`Unsafe shard claim: ${claimPath}`);
    const ownerPath = join(claimPath, 'owner');
    if (!existsSync(ownerPath)) return true;
    let owner: { pid?: number };
    try {
      owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as { pid?: number };
    } catch {
      return true;
    }
    if (typeof owner.pid !== 'number') return true;
    try {
      process.kill(owner.pid, 0);
      return true;
    } catch (error: unknown) {
      if (isCode(error, 'ESRCH')) {
        rmSync(claimPath, { recursive: true, force: true });
        return false;
      }
      return true;
    }
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function claimOwnerMatches(claimPath: string, token: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(join(claimPath, 'owner'), 'utf8')) as { token?: string };
    return owner.token === token;
  } catch {
    return false;
  }
}

function isAbandoned(lockPath: string, staleMs: number): boolean {
  try {
    const stats = lstatSync(lockPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) return false;
    if (Date.now() - stats.mtimeMs < staleMs) return false;
    const ownerPath = join(lockPath, 'owner');
    // Missing or malformed owner metadata means ownership is UNKNOWN:
    // preserve the lock (a live writer may exist between mkdir and write).
    if (!existsSync(ownerPath)) return false;
    let owner: { pid?: number };
    try {
      owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as { pid?: number };
    } catch {
      return false;
    }
    if (typeof owner.pid !== 'number') return false;
    // Same-host liveness probe: signal 0 delivers nothing but fails on dead
    // PIDs. Only ESRCH proves the writer is gone; EPERM means it EXISTS.
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error: unknown) {
      return isCode(error, 'ESRCH');
    }
  } catch {
    return false;
  }
}

function sanitizeLockName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/gu, '_');
  if (!sanitized || sanitized === '.' || sanitized === '..')
    throw new MemoryLockError('Shard scope resolves to an unusable lock name.');
  return sanitized;
}

function clampInteger(value: number, low: number, high: number, name: string): number {
  if (!Number.isInteger(value) || value < low || value > high)
    throw new MemoryLockError(`Shard barrier option ${name} must be an integer from ${low} to ${high}.`);
  return value;
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
