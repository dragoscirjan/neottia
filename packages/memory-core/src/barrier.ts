import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MemoryLockError } from './errors.js';

/**
 * Shard-scoped cross-process lock (neottia#1 decision #2): one lock directory
 * per namespace shard under the memory root. Acquisition uses atomic mkdir;
 * a lock older than `staleMs` is stolen so crashed writers cannot wedge the
 * shard forever. The v1 repo-global barrier becomes per-shard here.
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

/**
 * Runs `operation` while holding the exclusive lock for one memory shard.
 * Lock metadata records the owner PID and acquisition time so stale locks
 * can be identified and stolen.
 */
export function withShardBarrier<T>(
  memoryRoot: string,
  scopeKey: string,
  operation: (lease: ShardLease) => T,
  options: ShardBarrierOptions = {},
): T {
  const waitMs = clampInteger(options.waitMs ?? DEFAULT_WAIT_MS, 0, MAX_WAIT_MS, 'waitMs');
  const staleMs = clampInteger(options.staleMs ?? DEFAULT_STALE_MS, 1, Number.MAX_SAFE_INTEGER, 'staleMs');
  const pollMs = clampInteger(options.pollMs ?? DEFAULT_POLL_MS, 1, 1_000, 'pollMs');

  // The lock file name is sanitized: namespace components come from config
  // and must never turn into path traversal or nested directories.
  const lockPath = resolve(join(memoryRoot, '.locks'), `${sanitizeLockName(scopeKey)}.lock`);
  if (activeLocks.has(lockPath)) throw new MemoryLockError(`Shard barrier is non-reentrant: ${scopeKey}`);

  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      break;
    } catch (error: unknown) {
      if (!isCode(error, 'EEXIST')) throw new MemoryLockError(`Cannot acquire shard barrier: ${scopeKey}`);
      // A stale lock is stolen only when its writer is provably gone. A live
      // same-host PID keeps the lock, so long synchronous operations cannot
      // be interrupted mid-write by another local process.
      if (isAbandoned(lockPath, staleMs)) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new MemoryLockError(`Shard barrier is busy: ${scopeKey}`);
      sleep(pollMs);
    }
  }

  activeLocks.add(lockPath);
  try {
    writeFileSync(join(lockPath, 'owner'), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), {
      mode: 0o600,
    });
    return operation({ lockPath });
  } finally {
    activeLocks.delete(lockPath);
    try {
      rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // Fail closed: a release failure intentionally leaves the lock behind
      // so the next acquirer can detect and steal it once stale.
    }
  }
}

function isAbandoned(lockPath: string, staleMs: number): boolean {
  try {
    const stats = statSync(lockPath);
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
    // Same-host liveness probe: signal 0 delivers no signal but fails on dead
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
