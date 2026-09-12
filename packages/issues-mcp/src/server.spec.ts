import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ISSUE_TOOLS, issueToolJsonSchema, type DesignDocumentReferenceResolver } from '@neottia/issues';
import { afterEach, expect, it } from 'vitest';
import { createIssueServer } from './server.js';

const roots: string[] = [];
const clients: Client[] = [];
const servers: Array<ReturnType<typeof createIssueServer>> = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((connected) => connected.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
async function client(extraIssuesConfig = '', resolver?: DesignDocumentReferenceResolver): Promise<Client> {
  const cwd = mkdtempSync(join(tmpdir(), 'issues-mcp-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.neottia'), { recursive: true });
  writeFileSync(
    join(cwd, '.neottia/config.yml'),
    `version: 1\nskills:\n  issues:\n    enabled: true\n${extraIssuesConfig}`,
  );
  const server = createIssueServer({ cwd, resolver });
  servers.push(server);
  const result = new Client({ name: 'test', version: '1' });
  clients.push(result);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), result.connect(clientTransport)]);
  return result;
}

it('publishes all generated contracts and returns structured content/errors', async () => {
  const connected = await client();
  const listed = await connected.listTools();
  expect(listed.tools.map((tool) => tool.name)).toEqual(ISSUE_TOOLS.map((tool) => tool.name));
  for (const definition of ISSUE_TOOLS) {
    const published = listed.tools.find((tool) => tool.name === definition.name);
    expect(published?.inputSchema).toEqual(issueToolJsonSchema(definition.name, 'input'));
    expect(published?.outputSchema).toEqual(issueToolJsonSchema(definition.name, 'output'));
  }
  const created = await connected.callTool({ name: 'issue_create', arguments: { type: 'task', title: 'MCP issue' } });
  expect(created.isError).toBeFalsy();
  expect(created.structuredContent).toMatchObject({ title: 'MCP issue' });
  const invalid = await connected.callTool({ name: 'issue_get', arguments: {} });
  expect(invalid.isError).toBe(true);
  expect(JSON.parse(String((invalid.content as Array<{ text: string }>)[0]?.text))).toMatchObject({
    code: 'TOOL_INPUT_INVALID',
  });
});

it('composes the optional design-document resolver through MCP', async () => {
  const resolver: DesignDocumentReferenceResolver = {
    async resolveMany(references) {
      return {
        status: 'ok',
        results: references.map((reference) => ({
          status: 'resolved',
          reference,
          resolvedVersion: 1,
          location: 'active',
          revision: `sha256:${'0'.repeat(64)}`,
        })),
      };
    },
  };
  const connected = await client('', resolver);
  const created = await connected.callTool({ name: 'issue_create', arguments: { type: 'task', title: 'Linked' } });
  const issue = created.structuredContent as { id: string; revision: string };
  const linked = await connected.callTool({
    name: 'issue_link_document',
    arguments: { id: issue.id, expected_revision: issue.revision, document_id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV' },
  });
  expect(linked.isError).toBeFalsy();
  expect(linked.structuredContent).toMatchObject({ links: [{ id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV' }] });
});

it('preserves an explicit non-interactive stale_policy fail setting', async () => {
  const connected = await client('    cache:\n      stale_policy: fail\n');
  await connected.callTool({ name: 'issue_create', arguments: { type: 'task', title: 'No implicit rebuild' } });
  const search = await connected.callTool({ name: 'issue_search', arguments: { query: 'rebuild' } });
  expect(search.isError).toBe(true);
  expect(JSON.parse(String((search.content as Array<{ text: string }>)[0]?.text))).toMatchObject({
    category: 'storage',
    code: 'ISSUE_CACHE_REBUILD_REQUIRED',
    details: { reason: 'missing' },
  });
});
