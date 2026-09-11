import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import {
  DEFAULT_STORE_LIMITS,
  applyCanonicalBatch,
  readManagedFile,
  resolveManagedPath,
  resolveManagedRoot,
  withRepositoryLease,
} from './index.js';
import { setFilesystemFaultInjectorForTests } from './internal/fault-injection.js';

const roots: string[] = [];

afterEach(() => {
  setFilesystemFaultInjectorForTests(undefined);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('Bun uses native no-replace publication and preserves evacuation collisions', async () => {
  const authorityRoot = mkdtempSync(join(tmpdir(), 'neottia-bun-publication-'));
  roots.push(authorityRoot);
  const root = await resolveManagedRoot({ authorityRoot, limits: DEFAULT_STORE_LIMITS });
  const path = resolveManagedPath(root, 'record.txt');
  await withRepositoryLease(root, async (lease) => {
    await applyCanonicalBatch(root, lease, [
      { kind: 'write', path, bytes: new TextEncoder().encode('original'), expected: 'absent' },
    ]);
    const revision = (await readManagedFile(root, lease, path)).revision;
    let evacuation = '';
    setFilesystemFaultInjectorForTests((event, target) => {
      if (event === 'before-exact-evacuation') {
        evacuation = target;
        writeFileSync(target, 'operator');
      }
    });
    let code: unknown;
    try {
      await applyCanonicalBatch(root, lease, [
        { kind: 'write', path, bytes: new TextEncoder().encode('next'), expected: revision },
      ]);
    } catch (error: unknown) {
      code = error instanceof Error && 'code' in error ? error.code : undefined;
    }
    expect(code).toBe('RECOVERY_AMBIGUOUS');
    expect(readFileSync(join(root.managedRoot, path.relativePath), 'utf8')).toBe('original');
    expect(readFileSync(evacuation, 'utf8')).toBe('operator');
  });
});
