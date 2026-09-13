import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SEARCHABLE_TOOLS,
  searchableToolJsonSchema,
  type SearchableRuntime,
  type SearchableRuntimeOptions,
} from '@neottia/searchable-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import searchableExtension, {
  registerSearchableTools,
  searchableToolParameters,
  type PiExtensionApi,
} from './index.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it('registers all shared tools, forwards cancellation and CWD, then closes runtimes', async () => {
  const { pi, registered } = piRegistry();
  const { runtime, search, close } = fakeRuntime();
  const factory = vi.fn(() => runtime);
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
  expect(factory).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: '/tmp/project', config: expect.objectContaining({ enabled: true }) }),
  );
  expect(search).toHaveBeenCalledWith(
    expect.objectContaining({ query: 'test' }),
    expect.objectContaining({
      cwd: '/tmp/project',
      signal: controller.signal,
      config: expect.objectContaining({ enabled: true }),
    }),
  );
  await cleanup();
  expect(close).toHaveBeenCalledOnce();
});

it('isolates resolved runtime shards by invocation CWD', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-searchable-config-'));
  roots.push(root);
  const first = join(root, 'first');
  const second = join(root, 'second');
  for (const [cwd, configuredRoot] of [
    [first, 'search-first'],
    [second, 'search-second'],
  ]) {
    mkdirSync(join(cwd, '.neottia'), { recursive: true });
    writeFileSync(
      join(cwd, '.neottia/config.yml'),
      `version: 1\nmodules:\n  searchable:\n    enabled: true\n    root: ${configuredRoot}\n`,
    );
  }
  const { pi, registered } = piRegistry();
  const factory = vi.fn((options: SearchableRuntimeOptions) => {
    void options;
    return fakeRuntime().runtime;
  });
  const cleanup = registerSearchableTools(pi, { env: {}, runtimeFactory: factory });
  const webSearch = registered.find((tool) => tool.name === 'web_search');
  const signal = new AbortController().signal;
  await webSearch?.execute('1', { query: 'first' }, signal, vi.fn(), { cwd: first });
  await webSearch?.execute('2', { query: 'second' }, signal, vi.fn(), { cwd: second });
  expect(factory.mock.calls.map(([options]) => [options.cwd, options.config?.root])).toEqual([
    [first, 'search-first'],
    [second, 'search-second'],
  ]);
  await cleanup();
});

it('registers default-export shutdown and closes its runtime', async () => {
  let shutdown: (() => Promise<void>) | undefined;
  const { pi, registered } = piRegistry((_event, handler) => {
    shutdown = handler;
  });
  const { runtime, close } = fakeRuntime();
  searchableExtension(pi, {
    cwd: '/tmp/default',
    configOverrides: { enabled: true },
    runtimeFactory: () => runtime,
  });

  const webSearch = registered.find((tool) => tool.name === 'web_search');
  await webSearch?.execute('1', { query: 'test' }, new AbortController().signal, vi.fn(), {});
  expect(shutdown).toBeTypeOf('function');
  await shutdown?.();
  expect(close).toHaveBeenCalledOnce();
});

interface RegisteredTool {
  readonly name: string;
  readonly parameters?: unknown;
  execute: (...args: never[]) => Promise<{ details: Record<string, unknown> }>;
}

/** Captures Pi registrations while allowing a test-owned lifecycle callback. */
function piRegistry(on: PiExtensionApi['on'] = () => undefined): {
  readonly pi: PiExtensionApi;
  readonly registered: RegisteredTool[];
} {
  const registered: RegisteredTool[] = [];
  return {
    registered,
    pi: {
      registerTool(tool) {
        registered.push(tool as RegisteredTool);
      },
      on,
    },
  };
}

/** Minimal runtime and observable operations for host routing tests. */
function fakeRuntime() {
  const search = vi.fn(async () => ({ results: [] }));
  const close = vi.fn(async () => undefined);
  const runtime = {
    search,
    fetch: vi.fn(),
    stash: vi.fn(),
    grep: vi.fn(),
    ask: vi.fn(),
    close,
    store: {},
  } as unknown as SearchableRuntime;
  return { runtime, search, close };
}

describe('schema authority', () => {
  it('retains exactly five generated parameter contracts', () => {
    expect(Object.keys(searchableToolParameters)).toHaveLength(5);
  });
});
