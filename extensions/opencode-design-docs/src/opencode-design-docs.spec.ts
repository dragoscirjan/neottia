import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DESIGN_DOCS_TOOLS } from '@neottia/design-docs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDesignDocsTools, NeottiaDesignDocsPlugin, type OpenCodeToolFactory } from './index.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'oc-design-docs-'));
  roots.push(root);
  mkdirSync(join(root, '.neottia'));
  writeFileSync(join(root, '.neottia/config.yml'), 'version: 1\nskills:\n  design_docs:\n    enabled: true\n');
  return root;
}

describe('OpenCode Design Docs plugin', () => {
  it('registers and executes all shared tools in process', async () => {
    const cwd = fixture();
    const hooks = (await NeottiaDesignDocsPlugin({ directory: cwd } as never)) as unknown as {
      tool: Record<string, { execute(args: unknown, context?: unknown): Promise<string> }>;
    };
    expect(Object.keys(hooks.tool)).toEqual(DESIGN_DOCS_TOOLS.map((tool) => tool.name));
    const result = JSON.parse(await hooks.tool.document_create.execute({ title: 'OpenCode', kind: 'lld' }));
    expect(result).toMatchObject({ title: 'OpenCode', status: 'draft' });
    expect(
      DESIGN_DOCS_TOOLS.find((tool) => tool.name === 'document_create')?.outputSchema.safeParse(result).success,
    ).toBe(true);
    const error = JSON.parse(await hooks.tool.document_create.execute({ title: 'Invalid', kind: 'adr' }));
    expect(error).toMatchObject({ category: 'schema', code: 'TOOL_INPUT_INVALID' });
  });

  it('uses canonical Zod shapes with an injected factory', () => {
    const seen: unknown[] = [];
    const factory = ((definition: { args: unknown }) => {
      seen.push(definition.args);
      return definition;
    }) as unknown as OpenCodeToolFactory;
    buildDesignDocsTools({ cwd: fixture(), interactive: false }, factory);
    expect(seen).toEqual(DESIGN_DOCS_TOOLS.map((tool) => tool.inputSchema.shape));
  });
});
