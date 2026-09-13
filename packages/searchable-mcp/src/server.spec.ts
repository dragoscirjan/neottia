import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createSearchableRuntime,
  searchableToolJsonSchema,
  SEARCHABLE_TOOLS,
  type SearchableHttpTransport,
} from '@neottia/searchable-core';
import { afterEach, expect, it } from 'vitest';
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
  writeFileSync(join(cwd, '.neottia/config.yml'), 'version: 1\nskills:\n  searchable:\n    enabled: true\n');
  const transport: SearchableHttpTransport = {
    async request(input) {
      return { status: 200, headers: {}, bytes: Buffer.from('{}'), finalUrl: input.url };
    },
  };
  const server = createSearchableServer({
    cwd,
    runtimeFactory: (options) => createSearchableRuntime({ ...options, transport }),
  });
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
