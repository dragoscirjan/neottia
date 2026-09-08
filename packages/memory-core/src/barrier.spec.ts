import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryLockError, withShardBarrier, withShardBarrierAsync } from './index.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('shard barrier', () => {
  it('runs the operation inside an exclusive lock and releases it', () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-barrier-'));
    tempDirs.push(root);
    const result = withShardBarrier(root, 'local--project--global', () => 42);
    expect(result).toBe(42);
  });

  it('holds an async lock until the operation settles and releases it once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-barrier-'));
    tempDirs.push(root);
    let releaseOperation!: () => void;
    const operation = withShardBarrierAsync(
      root,
      'shard',
      () =>
        new Promise<void>((resolve) => {
          releaseOperation = resolve;
        }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    await expect(withShardBarrierAsync(root, 'shard', async () => 'blocked', { waitMs: 20 })).rejects.toThrow(
      MemoryLockError,
    );
    releaseOperation();
    await expect(operation).resolves.toBeUndefined();
    await expect(withShardBarrierAsync(root, 'shard', async () => 'available')).resolves.toBe('available');
  });

  it('does not block the event loop while asynchronously waiting for a lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-barrier-'));
    tempDirs.push(root);
    const lockPath = join(root, '.locks', 'shard.lock');
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, 'owner'), JSON.stringify({ pid: process.pid }));
    let timerRan = false;
    const timer = setTimeout(() => {
      timerRan = true;
    }, 0);
    await expect(withShardBarrierAsync(root, 'shard', async () => 'blocked', { waitMs: 50 })).rejects.toThrow(
      MemoryLockError,
    );
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    clearTimeout(timer);
    expect(timerRan).toBe(true);
  });

  it('rejects a symlinked lock directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-barrier-'));
    tempDirs.push(root);
    const target = mkdtempSync(join(tmpdir(), 'neottia-barrier-target-'));
    tempDirs.push(target);
    symlinkSync(target, join(root, '.locks'), 'dir');
    expect(() => withShardBarrier(root, 'shard', () => 1)).toThrow(/Unsafe shard barrier directory/u);
  });

  it('fails busy when another live process holds the lock, even past the stale window', () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-barrier-'));
    tempDirs.push(root);
    const lockPath = join(root, '.locks', 'shard.lock');
    mkdirSync(lockPath, { recursive: true });
    // Simulate a live-but-slow writer: our own PID, aged past the stale window.
    writeFileSync(join(lockPath, 'owner'), JSON.stringify({ pid: process.pid }));
    utimesSync(lockPath, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
    expect(() => withShardBarrier(root, 'shard', () => 1, { waitMs: 100, staleMs: 1000 })).toThrow(MemoryLockError);
  });

  it('preserves locks with unknown ownership (missing or malformed owner metadata)', () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-barrier-'));
    tempDirs.push(root);
    for (const ownerContent of [null, '{not-json']) {
      const lockPath = join(root, '.locks', 'shard.lock');
      rmSync(lockPath, { recursive: true, force: true });
      mkdirSync(lockPath, { recursive: true });
      if (ownerContent !== null) writeFileSync(join(lockPath, 'owner'), ownerContent);
      utimesSync(lockPath, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
      expect(() => withShardBarrier(root, 'shard', () => 1, { waitMs: 50, staleMs: 1000 })).toThrow(MemoryLockError);
    }
  });

  it('preserves locks when the liveness probe is inconclusive (EPERM)', () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-barrier-'));
    tempDirs.push(root);
    const lockPath = join(root, '.locks', 'shard.lock');
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, 'owner'), JSON.stringify({ pid: process.pid }));
    utimesSync(lockPath, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
    const kill = process.kill.bind(process);
    const spy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
      if (signal === 0) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      return kill(pid, signal as NodeJS.Signup);
    }) as typeof process.kill);
    try {
      expect(() => withShardBarrier(root, 'shard', () => 1, { waitMs: 50, staleMs: 1000 })).toThrow(MemoryLockError);
    } finally {
      spy.mockRestore();
    }
  });

  it('steals an abandoned lock whose writer PID is gone', () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-barrier-'));
    tempDirs.push(root);
    const lockPath = join(root, '.locks', 'shard.lock');
    mkdirSync(lockPath, { recursive: true });
    // PID 16777215 is (practically) never alive; stale and dead => steal.
    writeFileSync(join(lockPath, 'owner'), JSON.stringify({ pid: 16_777_215 }));
    utimesSync(lockPath, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
    const result = withShardBarrier(root, 'shard', () => 'stolen', { waitMs: 100, staleMs: 1000 });
    expect(result).toBe('stolen');
  });

  it('sanitizes hostile scope names into safe lock file names', () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-barrier-'));
    tempDirs.push(root);
    expect(withShardBarrier(root, '../../../evil', () => 1)).toBe(1);
  });
});
