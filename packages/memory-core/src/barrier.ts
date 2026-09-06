import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  const lockPath = resolve(join(memoryRoot, '.locks'), `${scopeKey}.lock`);
  if (activeLocks.has(lockPath)) throw new MemoryLockError(`Shard barrier is non-reentrant: ${scopeKey}`);

  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      break;
    } catch (error: unknown) {
      if (!isCode(error, 'EEXIST')) throw new MemoryLockError(`Cannot acquire shard barrier: ${scopeKey}`);
      if (isStale(lockPath, staleMs)) {
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

function isStale(lockPath: string, staleMs: number): boolean {
  try {
    const stats = statSync(lockPath);
    return Date.now() - stats.mtimeMs >= staleMs;
  } catch {
    return false;
  }
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
