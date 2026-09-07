import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { createMemoryServer, effectiveStalePolicy } from './server.js';

/**
 * Protocol-level integration tests: a real MCP client drives the real
 * server over an in-memory transport pair. Temp folders only.
 */

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

function fixture(overrides: Record<string, unknown> = {}): string {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-memory-mcp-'));
  tempDirs.push(cwd);
  const path = join(cwd, '.neottia', 'config.yml');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(
    path,
    stringify({ version: 1, skills: { memory: { enabled: true, ...overrides } } }, { lineWidth: 0 }),
    'utf8',
  );
  return cwd;
}

async function connect(cwd: string): Promise<Client> {
  const server = createMemoryServer({ cwd });
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const FACT = {
  memory_type: 'semantic',
  record_type: 'fact',
  summary: 'MCP tool parity fact',
  source: { kind: 'user-confirmed', ref: null, revision: null },
  created_by: 'test-client',
  confidence: 'confirmed',
};

describe('memory MCP server', () => {
  it('lists the nine memory tools with generated JSON schemas', async () => {
    const client = await connect(fixture());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
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
    const store = tools.find((tool) => tool.name === 'memory_store');
    expect(store?.inputSchema).toMatchObject({ type: 'object', properties: { summary: { type: 'string' } } });
  });

  it('stores and retrieves memory through the MCP protocol', async () => {
    const client = await connect(fixture());
    const stored = await client.callTool({ name: 'memory_store', arguments: FACT });
    expect(stored.isError).toBeFalsy();
    const record = JSON.parse((stored.content?.[0]?.text as string) ?? '{}');
    expect(record.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const fetched = await client.callTool({ name: 'memory_get', arguments: { id: record.id } });
    expect(JSON.parse((fetched.content?.[0]?.text as string) ?? '{}')).toMatchObject({
      summary: 'MCP tool parity fact',
    });

    const search = await client.callTool({ name: 'memory_search', arguments: { query: 'parity fact' } });
    expect(JSON.parse((search.content?.[0]?.text as string) ?? '[]')).toHaveLength(1);
  });

  it('surfaces tool errors as isError results with the message', async () => {
    const client = await connect(fixture());
    const bad = await client.callTool({ name: 'memory_get', arguments: { id: 'not-a-ulid' } });
    expect(bad.isError).toBe(true);
    expect(bad.content?.[0]?.text).toMatch(/memory_get input/i);

    const conflict = await client.callTool({ name: 'memory_store', arguments: { ...FACT, confidence: 'bogus' } });
    expect(conflict.isError).toBe(true);
    expect(conflict.content?.[0]?.text).toMatch(/memory_store input/i);
  });

  it('does not mutate anything when the shard is disabled', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'neottia-memory-mcp-off-'));
    tempDirs.push(cwd);
    const client = await connect(cwd);
    const result = await client.callTool({ name: 'memory_store', arguments: FACT });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/skills\.memory\.enabled=true.*disabled/u);
    expect(existsSync(join(cwd, '.neottia', 'memory'))).toBe(false);
  });

  it('downgrades prompt to rebuild for the non-interactive surface and respects fail', async () => {
    const cwd = fixture({ cache: { stale_policy: 'prompt' } });
    expect(effectiveStalePolicy(cwd)).toBe('rebuild');

    const failCwd = fixture({ cache: { stale_policy: 'fail' } });
    expect(effectiveStalePolicy(failCwd)).toBe('fail');
    const failClient = await connect(failCwd);
    await failClient.callTool({ name: 'memory_store', arguments: FACT });
    // Corrupt the disposable cache: with policy fail, search must refuse.
    writeFileSync(join(failCwd, '.neottia', 'memory', 'index.db'), 'corrupt');
    const refused = await failClient.callTool({ name: 'memory_search', arguments: { query: 'parity' } });
    expect(refused.isError).toBe(true);
    expect(refused.content?.[0]?.text).toMatch(/stale.*fail|Cannot open memory index/u);
  });
});
