import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryError } from './errors.js';
import { captureDirectoryIdentities } from './filesystem-safety.js';
import { SqliteIndex } from './index-sqlite.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('SQLite cache filesystem safety', () => {
  it.each(['', '-wal', '-shm'])('rejects a symbolic link used as the index%s artifact', (suffix) => {
    const root = temporaryDirectory();
    const outside = join(temporaryDirectory(), 'outside.db');
    writeFileSync(outside, 'not a database');
    symlinkSync(outside, join(root, `index.db${suffix}`));

    expect(() => SqliteIndex.open(root)).toThrow(/Unsafe memory cache artifact/u);
  });

  it('normalizes missing directory identity errors', () => {
    const missing = join(temporaryDirectory(), 'missing');
    expect(() => captureDirectoryIdentities(missing, 'test directory')).toThrow(MemoryError);
    expect(() => captureDirectoryIdentities(missing, 'test directory')).toThrow(/ENOENT/u);
  });

  it('rejects a symbolic-link cache root', () => {
    const parent = temporaryDirectory();
    const outside = temporaryDirectory();
    const root = join(parent, 'memory');
    symlinkSync(outside, root, 'dir');

    expect(() => SqliteIndex.open(root)).toThrow(/Unsafe memory cache directory/u);
  });

  it('detects deterministic artifact replacement after the database is open', () => {
    const root = temporaryDirectory();
    const outside = join(temporaryDirectory(), 'outside.db');
    writeFileSync(outside, 'outside remains unchanged');
    const index = SqliteIndex.open(root);
    rmSync(index.path);
    symlinkSync(outside, index.path);

    expect(() => index.meta()).toThrow(/Unsafe memory cache artifact/u);
    expect(() => index.close()).toThrow(/Unsafe memory cache artifact/u);
  });
});

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'neottia-index-safety-'));
  tempDirs.push(path);
  return path;
}
