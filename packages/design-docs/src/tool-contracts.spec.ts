import { describe, expect, it } from 'vitest';
import { designDocsToolJsonSchema, designDocsToolSchemas } from './tool-contracts.js';
import { DESIGN_DOCS_TOOLS } from './tools.js';

describe('shared Design Docs tool registry', () => {
  it('exposes the exact thirteen requested tools with Zod-derived errors', () => {
    expect(DESIGN_DOCS_TOOLS.map((tool) => tool.name)).toEqual([
      'document_id',
      'document_create',
      'document_list',
      'document_search',
      'document_get',
      'document_update',
      'document_transition',
      'document_version',
      'document_validate',
      'document_archive',
      'document_restore',
      'document_export',
      'document_import',
    ]);
    for (const tool of DESIGN_DOCS_TOOLS) {
      expect(tool.inputSchema).toBe(designDocsToolSchemas[tool.name].input);
      expect(tool.errorSchema).toBe(designDocsToolSchemas[tool.name].error);
      expect(designDocsToolJsonSchema(tool.name, 'input')).toMatchObject({ type: 'object' });
    }
  });

  it('accepts metadata as an object and rejects JSON-inside-string', () => {
    expect(
      designDocsToolSchemas.document_create.input.safeParse({ title: 'A', kind: 'hld', metadata: { owner: 'x' } })
        .success,
    ).toBe(true);
    expect(
      designDocsToolSchemas.document_create.input.safeParse({ title: 'A', kind: 'hld', metadata: '{"owner":"x"}' })
        .success,
    ).toBe(false);
  });
});
