import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { resolveHostConfigSnapshot } from '@neottia/config-registry';
import {
  createSearchableRuntime,
  searchableToolJsonSchema,
  SEARCHABLE_TOOLS,
  searchableConfigContribution,
  type SearchableHttpTransport,
  type SearchableRuntime,
  type SearchableRuntimeOptions,
} from '@neottia/searchable-core';
import { afterEach, expect, it, vi } from 'vitest';
import { createSearchableServer } from './server.js';

const roots: string[] = [];
const clients: Client[] = [];
const servers: Array<ReturnType<typeof createSearchableServer>> = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

it('publishes shared schemas and executes stash and grep through MCP', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-mcp-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.neottia'));
  writeFileSync(join(cwd, '.neottia/config.yml'), 'version: 1\nmodules:\n  searchable:\n    enabled: true\n');
  const transport: SearchableHttpTransport = {
    async request(input) {
      return { status: 200, headers: {}, bytes: Buffer.from('{}'), finalUrl: input.url };
    },
  };
  const runtimeFactory = vi.fn((options: SearchableRuntimeOptions) =>
    createSearchableRuntime({ ...options, transport }),
  );
  const server = createSearchableServer({ cwd, env: {}, runtimeFactory });
  expect(runtimeFactory).toHaveBeenCalledWith(
    expect.objectContaining({ cwd, config: expect.objectContaining({ enabled: true }) }),
  );
  servers.push(server);
  const client = new Client({ name: 'test', version: '1' });
  clients.push(client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
  expect(listed.tools.map((tool) => tool.name)).toEqual(SEARCHABLE_TOOLS.map((tool) => tool.name));
  for (const definition of SEARCHABLE_TOOLS) {
    const published = listed.tools.find((tool) => tool.name === definition.name);
    expect(published?.inputSchema).toEqual(searchableToolJsonSchema(definition.name, 'input'));
    expect(published?.outputSchema).toEqual(searchableToolJsonSchema(definition.name, 'output'));
  }
  const stashed = await client.callTool({
    name: 'web_stash',
    arguments: { url: 'https://example.com/page', title: 'Page', content: 'MCP searchable content' },
  });
  expect(stashed.isError).toBeFalsy();
  expect(stashed.structuredContent).toEqual({ stashed: true, url: 'https://example.com/page' });
  const grep = await client.callTool({ name: 'web_grep', arguments: { query: 'searchable' } });
  expect(grep.structuredContent).toMatchObject({ results: [{ url: 'https://example.com/page' }] });
  const invalid = await client.callTool({ name: 'web_search', arguments: {} });
  expect(invalid.isError).toBe(true);
  expect(JSON.parse(String((invalid.content as Array<{ text: string }>)[0]?.text))).toMatchObject({
    code: 'TOOL_INPUT_INVALID',
  });
});

it('applies every shared source layer and can reuse an injected snapshot without rereading files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'searchable-mcp-config-'));
  roots.push(root);
  const cwd = join(root, 'project');
  const globalRoot = join(root, 'global');
  mkdirSync(join(cwd, '.neottia'), { recursive: true });
  mkdirSync(join(globalRoot, 'neottia'), { recursive: true });
  writeFileSync(
    join(globalRoot, 'neottia/config.yml'),
    'version: 1\nmodules:\n  searchable:\n    search:\n      provider: brave\n',
  );
  const projectFile = join(cwd, '.neottia/config.yml');
  writeFileSync(
    projectFile,
    `version: 1
modules:
  searchable:
    enabled: true
    fetch:
      timeout_ms: 1111
profiles:
  selected:
    modules:
      searchable:
        grep:
          limit: 7
`,
  );
  const env = {
    XDG_CONFIG_HOME: globalRoot,
    NEOTTIA_PROFILE: 'selected',
    NEOTTIA_SEARCHABLE_SEARCH_LIMIT: '8',
  };
  const runtime = fakeRuntime();
  const runtimeFactory = vi.fn(() => runtime);
  const server = createSearchableServer({
    cwd,
    env,
    configOverrides: { ask: { limit: 9 } },
    runtimeFactory,
  });
  servers.push(server);
  const resolved = runtimeFactory.mock.calls[0]?.[0]?.config;
  expect(resolved).toMatchObject({
    enabled: true,
    search: { provider: 'brave', limit: 8 },
    fetch: { timeout_ms: 1111 },
    grep: { limit: 7 },
    ask: { limit: 9 },
    cache: { stale_policy: 'rebuild' },
  });

  const snapshot = resolveHostConfigSnapshot({ cwd, env, interactive: false });
  rmSync(projectFile);
  const injectedFactory = vi.fn(() => fakeRuntime());
  const injectedServer = createSearchableServer({ cwd, snapshot, runtimeFactory: injectedFactory });
  servers.push(injectedServer);
  expect(injectedFactory.mock.calls[0]?.[0]?.config).toBe(snapshot.get(searchableConfigContribution));
});

/** Minimal runtime used to inspect host configuration without service work. */
function fakeRuntime(): SearchableRuntime {
  return {
    search: vi.fn(),
    fetch: vi.fn(),
    stash: vi.fn(),
    grep: vi.fn(),
    ask: vi.fn(),
    close: vi.fn(async () => undefined),
    store: {},
  } as unknown as SearchableRuntime;
}
