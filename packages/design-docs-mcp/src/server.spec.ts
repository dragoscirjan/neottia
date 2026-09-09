import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DESIGN_DOCS_TOOLS, designDocsToolJsonSchema } from '@neottia/design-docs';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesignDocsServer, effectiveDesignDocsStalePolicy } from './server.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});
function fixture(enabled = true): string {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-design-mcp-'));
  roots.push(cwd);
  if (enabled) {
    mkdirSync(join(cwd, '.neottia'), { recursive: true });
    writeFileSync(join(cwd, '.neottia/config.yml'), 'version: 1\nskills:\n  design_docs:\n    enabled: true\n');
  }
  return cwd;
}
async function connect(cwd: string) {
  const server = createDesignDocsServer({ cwd });
  const client = new Client({ name: 'test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe('Design Docs MCP', () => {
  it('discovers shared schemas and calls tools with structured output', async () => {
    const { client, server } = await connect(fixture());
    const listed = await client.listTools();
    expect(listed.tools.map((entry) => entry.name)).toEqual(DESIGN_DOCS_TOOLS.map((entry) => entry.name));
    for (const definition of DESIGN_DOCS_TOOLS) {
      const published = listed.tools.find((entry) => entry.name === definition.name);
      expect(published?.inputSchema).toEqual(designDocsToolJsonSchema(definition.name, 'input'));
      expect(published?.outputSchema).toEqual(designDocsToolJsonSchema(definition.name, 'output'));
    }
    const created = await client.callTool({
      name: 'document_create',
      arguments: { title: 'MCP Design', kind: 'hld', body: 'Protocol content.' },
    });
    expect(created.isError).toBeFalsy();
    expect(created.structuredContent).toMatchObject({ title: 'MCP Design', status: 'draft' });
    const record = created.structuredContent as { id: string };
    const fetched = await client.callTool({ name: 'document_get', arguments: { id: record.id } });
    expect(fetched.structuredContent).toMatchObject({ id: record.id });
    const listedDocuments = await client.callTool({ name: 'document_list', arguments: {} });
    expect(listedDocuments.structuredContent).toMatchObject({ documents: [{ id: record.id }] });
    await server.close();
  });

  it('returns machine-readable errors and performs no disabled storage effects', async () => {
    const cwd = fixture(false);
    const { client, server } = await connect(cwd);
    const result = await client.callTool({ name: 'document_create', arguments: { title: 'No', kind: 'hld' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ category: 'disabled', code: 'CAPABILITY_DISABLED' });
    expect(existsSync(join(cwd, '.neottia'))).toBe(false);
    await server.close();
  });

  it('resolves prompt policy to rebuild without inventing approval evidence', () => {
    expect(effectiveDesignDocsStalePolicy(fixture())).toBe('rebuild');
  });
});
