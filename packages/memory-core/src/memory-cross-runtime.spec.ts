import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { MemoryStore, loadMemoryConfig } from './index.js';

const roots: string[] = [];
const worker = fileURLToPath(new URL('./memory-cross-runtime.fixture.ts', import.meta.url));
const crashWorker = fileURLToPath(new URL('./memory-crash.fixture.ts', import.meta.url));

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function memoryFixture(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  roots.push(cwd);
  mkdirSync(join(cwd, '.neottia'), { recursive: true });
  writeFileSync(
    join(cwd, '.neottia', 'config.yml'),
    stringify({ version: 1, skills: { memory: { enabled: true } } }, { lineWidth: 0 }),
  );
  return cwd;
}

describe('Memory Node/Bun compatibility', () => {
  it.each([
    ['node', 'bun'],
    ['bun', 'node'],
  ] as const)(
    '%s rebuild is verified and searched by %s without canonical byte changes',
    (writer, reader) => {
      const cwd = memoryFixture(`neottia-memory-${writer}-${reader}-`);
      const run = (runtime: 'node' | 'bun', arguments_: readonly string[]): string =>
        execFileSync(
          runtime === 'node' ? process.execPath : 'bun',
          [...(runtime === 'node' ? ['--import', 'tsx'] : []), worker, ...arguments_],
          { encoding: 'utf8' },
        ).trim();
      const id = run(writer, ['seed', cwd]);
      const canonical = join(cwd, '.neottia', 'memory', 'facts', `${id}.yaml`);
      const before = readFileSync(canonical);
      run(reader, ['verify', cwd, id]);
      expect(readFileSync(canonical)).toEqual(before);
    },
    30_000,
  );

  it.each(['canonical-path-published', 'committed-state-synced'] as const)(
    'recovers a Memory mutation interrupted at %s and empties transaction state',
    async (event) => {
      const cwd = memoryFixture(`neottia-memory-crash-${event}-`);
      const child = spawnSync(process.execPath, ['--import', 'tsx', crashWorker, cwd, event]);
      expect(child.signal).toBe('SIGKILL');
      const leasePath = join(cwd, '.neottia', 'repository-store', 'authority.lease');
      utimesSync(leasePath, new Date(0), new Date(0));
      const store = MemoryStore.fromConfig(loadMemoryConfig(cwd, { env: {} }), cwd);
      await expect(store.validate()).resolves.toMatchObject({ valid: true });
      const transactions = join(cwd, '.neottia', 'repository-store', 'transactions');
      const managedRoots = existsSync(transactions) ? readdirSync(transactions) : [];
      for (const managedRoot of managedRoots) expect(readdirSync(join(transactions, managedRoot))).toEqual([]);
    },
    30_000,
  );
});
