import { SEARCHABLE_TOOLS, type SearchableRuntime } from '@neottia/searchable-core';
import { expect, it, vi } from 'vitest';
import { buildSearchableTools, createSearchablePlugin } from './index.js';

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
    { cwd: '/tmp/project', services: runtime, configOverrides: { enabled: true } },
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

it('creates and disposes one runtime for the host directory', async () => {
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
  const plugin = createSearchablePlugin({ runtimeFactory: () => runtime });
  const hooks = await plugin({ directory: '/tmp/project' } as never);
  await hooks.dispose?.();
  expect(close).toHaveBeenCalledOnce();
});
