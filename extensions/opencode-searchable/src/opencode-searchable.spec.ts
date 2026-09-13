import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SEARCHABLE_TOOLS,
  searchableConfigSchema,
  type SearchableRuntime,
  type SearchableRuntimeOptions,
} from '@neottia/searchable-core';
import { afterEach, expect, it, vi } from 'vitest';
import { buildSearchableTools, createSearchablePlugin } from './index.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it('builds every shared tool and forwards OpenCode cancellation', async () => {
  const search = vi.fn(async () => ({ results: [] }));
  const runtime = {
    search,
    fetch: vi.fn(),
    stash: vi.fn(),
    grep: vi.fn(),
    ask: vi.fn(),
    close: vi.fn(),
    store: {},
  } as unknown as SearchableRuntime;
  const factory = vi.fn((definition) => definition) as never;
  const tools = buildSearchableTools(
    { cwd: '/tmp/project', services: runtime, config: searchableConfigSchema.parse({ enabled: true }) },
    factory,
  ) as Record<string, { execute(args: Record<string, unknown>, invocation: Record<string, unknown>): Promise<string> }>;
  expect(Object.keys(tools)).toEqual(SEARCHABLE_TOOLS.map((tool) => tool.name));
  const controller = new AbortController();
  await tools['web_search']?.execute({ query: 'test' }, { abort: controller.signal });
  expect(search).toHaveBeenCalledWith(
    expect.objectContaining({ query: 'test' }),
    expect.objectContaining({ cwd: '/tmp/project', signal: controller.signal }),
  );
});

it('resolves one non-interactive shard for the host directory and disposes its runtime', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'opencode-searchable-config-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.neottia'));
  writeFileSync(
    join(cwd, '.neottia/config.yml'),
    'version: 1\nmodules:\n  searchable:\n    enabled: true\n    search:\n      provider: brave\n',
  );
  const close = vi.fn(async () => undefined);
  const runtime = {
    search: vi.fn(),
    fetch: vi.fn(),
    stash: vi.fn(),
    grep: vi.fn(),
    ask: vi.fn(),
    close,
    store: {},
  } as unknown as SearchableRuntime;
  const runtimeFactory = vi.fn((options: SearchableRuntimeOptions) => {
    void options;
    return runtime;
  });
  const plugin = createSearchablePlugin({
    env: { NEOTTIA_SEARCHABLE_SEARCH_LIMIT: '8' },
    configOverrides: { ask: { limit: 9 } },
    runtimeFactory,
  });
  const hooks = await plugin({ directory: cwd } as never);
  expect(runtimeFactory.mock.calls[0]?.[0]).toMatchObject({
    cwd,
    config: {
      enabled: true,
      search: { provider: 'brave', limit: 8 },
      ask: { limit: 9 },
      cache: { stale_policy: 'rebuild' },
    },
  });
  await hooks.dispose?.();
  expect(close).toHaveBeenCalledOnce();
});
