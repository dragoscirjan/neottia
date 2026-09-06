import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryLockError, withShardBarrier } from './index.js';

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
