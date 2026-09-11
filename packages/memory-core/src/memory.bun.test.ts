import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { loadMemoryConfig } from './config.js';
import { MemoryStore } from './store.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() as string, { recursive: true, force: true });
});

describe('filesystem Memory on Bun', () => {
  test('publishes canonical YAML and rebuilds/searches the repository-store cache', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'neottia-memory-bun-'));
    directories.push(cwd);
    const store = MemoryStore.fromConfig(loadMemoryConfig(cwd, { env: { NEOTTIA_MEMORY_ENABLED: 'true' } }), cwd);
    const stored = await store.store({
      memory_type: 'semantic',
      record_type: 'fact',
      summary: 'Bun repository cache interoperability',
      source: { kind: 'user-confirmed', ref: null, revision: null },
      created_by: 'bun-test',
      confidence: 'confirmed',
    });
    await store.validate();
    const result = await store.search({ query: 'interoperability' });
    expect(result.map((record) => record.id)).toEqual([stored.id]);
    expect(existsSync(join(cwd, '.neottia', 'memory', 'facts', `${stored.id}.yaml`))).toBe(true);
    expect(existsSync(join(cwd, '.neottia', 'memory', 'index.db'))).toBe(true);
    await store.close();
  });
});
