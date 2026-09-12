import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesignDocumentStore, loadDesignDocsConfig } from '@neottia/design-docs';
import { ISSUE_TOOLS } from '@neottia/issues';
import { afterEach, expect, it } from 'vitest';
import { buildIssueTools, createIssuesPlugin } from './index.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'opencode-issues-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.neottia'));
  writeFileSync(
    join(cwd, '.neottia/config.yml'),
    'version: 1\nskills:\n  issues:\n    enabled: true\n  design_docs:\n    enabled: true\n',
  );
  return cwd;
}

it('builds every OpenCode tool from the shared registry', () => {
  const factory = ((definition: unknown) => definition) as never;
  const tools = buildIssueTools({ cwd: '/tmp', interactive: false, configOverrides: { enabled: false } }, factory);
  expect(Object.keys(tools)).toEqual(ISSUE_TOOLS.map((tool) => tool.name));
});

it('uses the real design-document resolver by default', async () => {
  const cwd = project();
  const documents = await DesignDocumentStore.fromConfig(loadDesignDocsConfig(cwd), cwd);
  const document = await documents.create({ title: 'OpenCode target', kind: 'hld' });
  const plugin = createIssuesPlugin();
  const hooks = (await plugin({ directory: cwd } as never)) as unknown as {
    tool: Record<string, { execute(args: Record<string, unknown>, context?: unknown): Promise<string> }>;
  };
  const created = JSON.parse(await hooks.tool.issue_create.execute({ type: 'task', title: 'Linked' }, {})) as {
    id: string;
    revision: string;
  };
  const linked = JSON.parse(
    await hooks.tool.issue_link_document.execute(
      {
        id: created.id,
        expected_revision: created.revision,
        document_id: document.id,
      },
      {},
    ),
  );
  expect(linked).toMatchObject({ links: [{ id: document.id }] });
});
