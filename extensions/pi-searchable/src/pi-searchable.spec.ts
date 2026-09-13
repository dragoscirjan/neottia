import { SEARCHABLE_TOOLS, searchableToolJsonSchema, type SearchableRuntime } from '@neottia/searchable-core';
import { describe, expect, it, vi } from 'vitest';
import searchableExtension, {
  registerSearchableTools,
  searchableToolParameters,
  type PiExtensionApi,
} from './index.js';

it('registers all shared tools, forwards cancellation and CWD, then closes runtimes', async () => {
  const registered: Array<{
    name: string;
    parameters: unknown;
    execute: (...args: never[]) => Promise<{ details: Record<string, unknown> }>;
  }> = [];
  const pi: PiExtensionApi = {
    registerTool(tool) {
      registered.push(tool as (typeof registered)[number]);
    },
    on() {},
  };
  const search = vi.fn(async () => ({ results: [] }));
  const close = vi.fn(async () => undefined);
  const factory = vi.fn(
    () =>
      ({
        search,
        fetch: vi.fn(),
        stash: vi.fn(),
        grep: vi.fn(),
        ask: vi.fn(),
        close,
        store: {},
      }) as unknown as SearchableRuntime,
  );
  const cleanup = registerSearchableTools(pi, {
    cwd: '/tmp/default',
    configOverrides: { enabled: true },
    runtimeFactory: factory,
  });
  expect(registered.map((tool) => tool.name)).toEqual(SEARCHABLE_TOOLS.map((tool) => tool.name));
  for (const definition of SEARCHABLE_TOOLS)
    expect(searchableToolParameters[definition.name]).toEqual(
      expect.objectContaining(searchableToolJsonSchema(definition.name, 'input')),
    );
  const controller = new AbortController();
  const webSearch = registered.find((tool) => tool.name === 'web_search');
  await webSearch?.execute('1', { query: 'test' }, controller.signal, vi.fn(), { cwd: '/tmp/project' });
  expect(factory).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/tmp/project' }));
  expect(search).toHaveBeenCalledWith(
    expect.objectContaining({ query: 'test' }),
    expect.objectContaining({ cwd: '/tmp/project', signal: controller.signal }),
  );
  await cleanup();
  expect(close).toHaveBeenCalledOnce();
});

it('registers default-export shutdown and closes its runtime', async () => {
  const registered: Array<{
    name: string;
    execute: (...args: never[]) => Promise<{ details: Record<string, unknown> }>;
  }> = [];
  let shutdown: (() => Promise<void>) | undefined;
  const pi: PiExtensionApi = {
    registerTool(tool) {
      registered.push(tool as (typeof registered)[number]);
    },
    on(_event, handler) {
      shutdown = handler;
    },
  };
  const close = vi.fn(async () => undefined);
  searchableExtension(pi, {
    cwd: '/tmp/default',
    configOverrides: { enabled: true },
    runtimeFactory: () =>
      ({
        search: vi.fn(async () => ({ results: [] })),
        fetch: vi.fn(),
        stash: vi.fn(),
        grep: vi.fn(),
        ask: vi.fn(),
        close,
        store: {},
      }) as unknown as SearchableRuntime,
  });

  const webSearch = registered.find((tool) => tool.name === 'web_search');
  await webSearch?.execute('1', { query: 'test' }, new AbortController().signal, vi.fn(), {});
  expect(shutdown).toBeTypeOf('function');
  await shutdown?.();
  expect(close).toHaveBeenCalledOnce();
});

describe('schema authority', () => {
  it('retains exactly five generated parameter contracts', () => {
    expect(Object.keys(searchableToolParameters)).toHaveLength(5);
  });
});
