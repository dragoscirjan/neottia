import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMemoryConfig, MemoryStore } from '@neottia/memory-core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMemoryTools, NeottiaMemoryPlugin, type OpenCodeToolFactory } from './index.js';

/**
 * Unit tests: the plugin builds real OpenCode tool definitions and routes
 * execution through the store. The real-harness E2E lives in
 * opencode.plugin.harness.test.ts (opt-in via NEOTTIA_TEST_HARNESS).
 */

const projects: string[] = [];

afterEach(() => {
  while (projects.length) rmSync(projects.pop() as string, { recursive: true, force: true });
});

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-oc-ext-'));
  projects.push(cwd);
  const path = join(cwd, '.neottia', 'config.yml');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'version: 1\nskills:\n  memory:\n    enabled: true\n', 'utf8');
  return cwd;
}

const FACT = {
  memory_type: 'semantic',
  record_type: 'fact',
  summary: 'The OpenCode plugin stores memories in process',
  source: { kind: 'user-confirmed', ref: null, revision: null },
  created_by: 'agent:opencode',
  confidence: 'confirmed',
};

describe('opencode memory plugin', () => {
  it('registers exactly the nine memory tools', async () => {
    const cwd = fixture();
    const hooks = (await NeottiaMemoryPlugin({ directory: cwd } as never)) as {
      tool: Record<string, { description: string; execute: unknown }>;
    };
    expect(Object.keys(hooks.tool).sort()).toEqual(
      [
        'memory_store',
        'memory_supersede',
        'memory_delete',
        'memory_get',
        'memory_list',
        'memory_search',
        'memory_validate',
        'memory_export',
        'memory_import',
      ].sort(),
    );
    for (const definition of Object.values(hooks.tool)) expect(definition.execute).toBeTypeOf('function');
  });

  it('executes memory_store through the host tool contract', async () => {
    const cwd = fixture();
    const hooks = (await NeottiaMemoryPlugin({ directory: cwd } as never)) as {
      tool: Record<string, { execute: (args: unknown) => Promise<string> }>;
    };
    const text = await hooks.tool['memory_store'].execute(FACT);
    const record = JSON.parse(text);
    expect(record.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const yaml = readFileSync(join(cwd, '.neottia', 'memory', 'facts', `${record.id}.yaml`), 'utf8');
    expect(yaml).toContain('in process');
  });

  it('resolves the store from the plugin context directory', async () => {
    const cwd = fixture();
    const seeded = await MemoryStore.fromConfig(loadMemoryConfig(cwd, { env: {} }), cwd).store({
      ...FACT,
      summary: 'Seeded before list',
    });

    const hooks = (await NeottiaMemoryPlugin({ directory: cwd } as never)) as {
      tool: Record<string, { execute: (args: unknown) => Promise<string> }>;
    };
    const text = await hooks.tool['memory_list'].execute({});
    expect(text).toContain(seeded.id);
  });

  it('builds tools through the injected factory (host contract check)', () => {
    const cwd = fixture();
    const seen: Array<{ description: string; args: unknown }> = [];
    const factory = ((input: { description: string; args: unknown }) => {
      seen.push({ description: input.description, args: input.args });
      return { description: input.description, execute: input.execute ?? (() => Promise.resolve('')) };
    }) as unknown as OpenCodeToolFactory;

    const tools = buildMemoryTools({ cwd, interactive: true }, factory);
    expect(seen).toHaveLength(9);
    expect(Object.keys(tools)).toHaveLength(9);
    // args arrive as the Zod raw shape the host expects
    expect(seen[0]?.args).toMatchObject({ summary: expect.anything() });
  });
});
