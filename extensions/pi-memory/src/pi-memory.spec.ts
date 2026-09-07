import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerMemoryTools, memoryToolParameters, type PiExtensionApi } from './index.js';

/**
 * Unit tests: drive the extension with a fake pi API against a temp project.
 * The real-harness E2E lives in pi.plugin.harness.test.ts (opt-in).
 */

const projects: string[] = [];

afterEach(() => {
  while (projects.length) rmSync(projects.pop() as string, { recursive: true, force: true });
});

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-pi-ext-'));
  projects.push(cwd);
  const path = join(cwd, '.neottia', 'config.yml');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'version: 1\nskills:\n  memory:\n    enabled: true\n', 'utf8');
  return cwd;
}

function fakePi() {
  const registered: Array<Record<string, unknown>> = [];
  const api = {
    registerTool: (tool: Record<string, unknown>) => registered.push(tool),
  } as unknown as PiExtensionApi;
  return { api, registered };
}

const FACT = {
  memory_type: 'semantic',
  record_type: 'fact',
  summary: 'The pi extension stores memories in process',
  source: { kind: 'user-confirmed', ref: null, revision: null },
  created_by: 'agent:pi',
  confidence: 'confirmed',
};

describe('pi memory extension', () => {
  it('registers exactly the nine memory tools with TypeBox parameters', () => {
    const cwd = fixture();
    const { api, registered } = fakePi();
    registerMemoryTools(api, { cwd });
    expect(registered.map((tool) => tool.name)).toEqual([
      'memory_store',
      'memory_supersede',
      'memory_delete',
      'memory_get',
      'memory_list',
      'memory_search',
      'memory_validate',
      'memory_export',
      'memory_import',
    ]);
    for (const tool of registered) {
      expect(tool.parameters).toBeDefined();
      expect(Object.keys(memoryToolParameters)).toContain(tool.name);
    }
  });

  it('stores a memory in-process through the tool handler', async () => {
    const cwd = fixture();
    const { api, registered } = fakePi();
    registerMemoryTools(api, { cwd });
    const store = registered.find((tool) => tool.name === 'memory_store') as {
      execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>;
    };

    const result = await store.execute('call-1', FACT);
    const record = JSON.parse(result.content[0].text);
    expect(record.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // Deterministic check: canonical YAML on disk inside the temp project.
    const yaml = readFileSync(join(cwd, '.neottia', 'memory', 'facts', `${record.id}.yaml`), 'utf8');
    expect(yaml).toContain('in process');
  });

  it('rejects invalid tool input with the store contract message', async () => {
    const cwd = fixture();
    const { api, registered } = fakePi();
    registerMemoryTools(api, { cwd });
    const get = registered.find((tool) => tool.name === 'memory_get') as {
      execute: (id: string, params: unknown) => Promise<unknown>;
    };
    await expect(get.execute('call-1', { id: 'nope' })).rejects.toThrow(/memory_get input/i);
  });

  it('is usable as the default entry point against a temp project', async () => {
    const cwd = fixture();
    const { api, registered } = fakePi();
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      registerMemoryTools(api);
      const list = registered.find((tool) => tool.name === 'memory_list') as {
        execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>;
      };
      const result = await list.execute('call-1', {});
      expect(JSON.parse(result.content[0].text)).toEqual([]);
      expect(existsSync(join(cwd, '.neottia', 'memory'))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      vi.doUnmock('@neottia/memory-core');
      vi.resetModules();
    }
  });
});
