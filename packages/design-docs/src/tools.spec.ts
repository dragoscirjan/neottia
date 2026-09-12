import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { designDocsToolSchemas } from './tool-contracts.js';
import { closeDesignDocsToolContext, findDesignDocsTool, type DesignDocsToolContext } from './tools.js';

const roots: string[] = [];
const contexts: DesignDocsToolContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => closeDesignDocsToolContext(context)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(maxResultBytes = 4 * 1024 * 1024): Promise<DesignDocsToolContext> {
  const cwd = await mkdtemp(join(tmpdir(), 'neottia-design-tools-'));
  roots.push(cwd);
  const context: DesignDocsToolContext = {
    cwd,
    interactive: false,
    configOverrides: { enabled: true, security: { limits: { max_result_bytes: maxResultBytes } } },
    storeKey: {},
  };
  contexts.push(context);
  return context;
}

function tool(name: string) {
  const definition = findDesignDocsTool(name);
  if (!definition) throw new Error(`Missing tool ${name}.`);
  return definition;
}

async function create(context: DesignDocsToolContext, title = 'UTF-8 😀') {
  return tool('document_create').run(context, { title, kind: 'hld', body: 'Body 😀' });
}

describe('shared Design Docs tool result budget', () => {
  it('measures the compact validated response in UTF-8 bytes and allows equality', async () => {
    const seed = await project();
    const created = (await create(seed)) as { id: string };
    const expected = designDocsToolSchemas.document_get.output.parse(
      await tool('document_get').run(seed, { id: created.id }),
    );
    const serialized = JSON.stringify(expected);
    const actual = Buffer.byteLength(serialized, 'utf8');
    expect(actual).toBeGreaterThan(serialized.length);

    const exact = projectAt(seed.cwd, actual);
    await expect(tool('document_get').run(exact, { id: created.id })).resolves.toEqual(expected);
    const short = projectAt(seed.cwd, actual - 1);
    await expect(tool('document_get').run(short, { id: created.id })).rejects.toMatchObject({
      code: 'TOOL_RESULT_LIMIT',
      details: { maximum: actual - 1, actual, tool: 'document_get' },
    });
  });

  it.each(['document_list', 'document_get', 'document_export'])('bounds %s at the shared boundary', async (name) => {
    const seed = await project();
    const created = (await create(seed)) as { id: string };
    const limited = projectAt(seed.cwd, 1);
    const input = name === 'document_get' ? { id: created.id } : {};
    await expect(tool(name).run(limited, input)).rejects.toMatchObject({
      category: 'resource_limit',
      code: 'TOOL_RESULT_LIMIT',
      details: { maximum: 1, tool: name },
    });
  });

  it('does not roll back a successful mutation whose response is too large', async () => {
    const limited = await project(1);
    await expect(create(limited, 'Published despite response limit')).rejects.toMatchObject({
      code: 'TOOL_RESULT_LIMIT',
    });
    const reader = projectAt(limited.cwd, 4 * 1024 * 1024);
    const result = (await tool('document_list').run(reader, {})) as { documents: Array<{ title: string }> };
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.title).toBe('Published despite response limit');
  });
});

function projectAt(cwd: string, maxResultBytes: number): DesignDocsToolContext {
  const context: DesignDocsToolContext = {
    cwd,
    interactive: false,
    configOverrides: { enabled: true, security: { limits: { max_result_bytes: maxResultBytes } } },
    storeKey: {},
  };
  contexts.push(context);
  return context;
}
