import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesignDocumentStore, loadDesignDocsConfig } from '@neottia/design-docs';
import { ISSUE_TOOLS, issueToolJsonSchema } from '@neottia/issues';
import { afterEach, describe, expect, it } from 'vitest';
import { issueToolParameters, registerIssueTools, type PiExtensionApi } from './index.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-issues-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.neottia'));
  writeFileSync(
    join(cwd, '.neottia/config.yml'),
    'version: 1\nskills:\n  issues:\n    enabled: true\n  design_docs:\n    enabled: true\n',
  );
  return cwd;
}

describe('Pi issues adapter', () => {
  it('registers generated schemas and isolates invocation working directories', async () => {
    const registered: Array<Parameters<PiExtensionApi['registerTool']>[0]> = [];
    const api: PiExtensionApi = { on: () => undefined, registerTool: (definition) => registered.push(definition) };
    const close = registerIssueTools(api);
    expect(registered.map((tool) => tool.name)).toEqual(ISSUE_TOOLS.map((tool) => tool.name));
    expect(issueToolParameters.issue_create).toMatchObject(issueToolJsonSchema('issue_create', 'input'));
    const create = registered.find((tool) => tool.name === 'issue_create')!;
    const list = registered.find((tool) => tool.name === 'issue_list')!;
    const [first, second] = [project(), project()];
    const signal = new AbortController().signal;
    await create.execute('1', { type: 'task', title: 'Only first' }, signal, () => undefined, { cwd: first });
    await create.execute('2', { type: 'task', title: 'Only second' }, signal, () => undefined, { cwd: second });
    const firstList = await list.execute('3', {}, signal, () => undefined, { cwd: first });
    const secondList = await list.execute('4', {}, signal, () => undefined, { cwd: second });
    expect(firstList.content[0]?.text).toContain('Only first');
    expect(firstList.content[0]?.text).not.toContain('Only second');
    expect(secondList.content[0]?.text).toContain('Only second');
    expect(secondList.content[0]?.text).not.toContain('Only first');
    await close();
  });

  it('uses the real design-document resolver by default', async () => {
    const registered: Array<Parameters<PiExtensionApi['registerTool']>[0]> = [];
    const api: PiExtensionApi = { on: () => undefined, registerTool: (definition) => registered.push(definition) };
    const close = registerIssueTools(api);
    const cwd = project();
    const documents = await DesignDocumentStore.fromConfig(loadDesignDocsConfig(cwd), cwd);
    const document = await documents.create({ title: 'Pi target', kind: 'hld' });
    const signal = new AbortController().signal;
    const created = await registered
      .find((tool) => tool.name === 'issue_create')!
      .execute('1', { type: 'task', title: 'Linked' }, signal, () => undefined, { cwd });
    const issue = created.details.result as { id: string; revision: string };
    const linked = await registered
      .find((tool) => tool.name === 'issue_link_document')!
      .execute(
        '2',
        { id: issue.id, expected_revision: issue.revision, document_id: document.id },
        signal,
        () => undefined,
        { cwd },
      );
    expect(linked.details.result).toMatchObject({ links: [{ id: document.id }] });
    await close();
  });

  it('uses Pi confirmation for prompt cache policy', async () => {
    const registered: Array<Parameters<PiExtensionApi['registerTool']>[0]> = [];
    const api: PiExtensionApi = { on: () => undefined, registerTool: (definition) => registered.push(definition) };
    const close = registerIssueTools(api);
    const cwd = project();
    const signal = new AbortController().signal;
    await registered
      .find((tool) => tool.name === 'issue_create')!
      .execute('1', { type: 'task', title: 'Prompt' }, signal, () => undefined, { cwd });
    await expect(
      registered
        .find((tool) => tool.name === 'issue_search')!
        .execute('2', { query: 'Prompt' }, signal, () => undefined, { cwd, ui: { confirm: async () => false } }),
    ).rejects.toThrow(/requires rebuild/u);
    await close();
  });
});
