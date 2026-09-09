import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DESIGN_DOCS_TOOLS, designDocsToolJsonSchema } from '@neottia/design-docs';
import { afterEach, describe, expect, it } from 'vitest';
import { designDocsToolParameters, registerDesignDocsTools, type PiExtensionApi } from './index.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-design-docs-'));
  roots.push(root);
  mkdirSync(join(root, '.neottia'));
  writeFileSync(join(root, '.neottia/config.yml'), 'version: 1\nskills:\n  design_docs:\n    enabled: true\n');
  return root;
}

describe('Pi Design Docs extension', () => {
  it('publishes generated schemas and routes each call to active cwd', async () => {
    const registered = new Map<string, Parameters<PiExtensionApi['registerTool']>[0]>();
    const api: PiExtensionApi = {
      on: () => undefined,
      registerTool: (definition) => {
        registered.set(definition.name, definition);
      },
    };
    const close = registerDesignDocsTools(api);
    expect(Object.keys(designDocsToolParameters)).toEqual(DESIGN_DOCS_TOOLS.map((tool) => tool.name));
    for (const definition of DESIGN_DOCS_TOOLS)
      expect(designDocsToolParameters[definition.name]).toEqual(designDocsToolJsonSchema(definition.name, 'input'));
    const first = fixture();
    const second = fixture();
    const create = registered.get('document_create')!;
    await create.execute('1', { title: 'First', kind: 'hld' }, new AbortController().signal, () => undefined, {
      cwd: first,
    });
    await create.execute('2', { title: 'Second', kind: 'lld' }, new AbortController().signal, () => undefined, {
      cwd: second,
    });
    expect(registered.size).toBe(13);
    await expect(
      create.execute('3', { title: 'Invalid', kind: 'adr' }, new AbortController().signal, () => undefined, {
        cwd: first,
      }),
    ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    await close();
  });
});
