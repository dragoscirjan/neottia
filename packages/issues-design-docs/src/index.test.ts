import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesignDocumentStore, loadDesignDocsConfig } from '@neottia/design-docs';
import { decodeIssue, encodeIssue, IssueStore, loadIssueConfig } from '@neottia/issues';
import { DEFAULT_STORE_LIMITS, resolveManagedRoot, withRepositoryLease } from '@neottia/repository-store';
import { afterEach, describe, expect, it } from 'vitest';
import { createIssuesDesignDocsComposition } from './index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('Issues and Design Docs composition', () => {
  it('resolves real stable links and validates them under one repository lease', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'neottia-composition-'));
    roots.push(cwd);
    const composition = createIssuesDesignDocsComposition({
      cwd,
      issuesConfigOverrides: { enabled: true },
      designDocsConfigOverrides: { enabled: true },
    });
    const documents = await DesignDocumentStore.fromConfig(loadDesignDocsConfig(cwd, { enabled: true }), cwd, {
      linkValidator: composition.linkValidator,
    });
    const issues = new IssueStore(loadIssueConfig(cwd, { enabled: true }), cwd, {
      resolver: composition.resolver,
    });
    const original = await documents.create({ title: 'Stable architecture', kind: 'hld', body: 'Decision.' });
    const renamed = await documents.update(original.id, {
      expected_revision: original.revision,
      title: 'Renamed architecture',
    });
    const issue = await issues.create({ type: 'task', title: 'Implement architecture' });
    const unpinned = await issues.linkDocument(issue.id, { kind: 'design-doc', id: renamed.id });
    const pinned = await issues.linkDocument(
      issue.id,
      { kind: 'design-doc', id: renamed.id, version: 1 },
      unpinned.revision,
    );
    await issues.update(issue.id, pinned.revision, { title: 'Renamed implementation' });
    const review = await documents.transition(renamed.id, {
      expected_revision: renamed.revision,
      to: 'review',
      intent: 'Review the stable-link design.',
      actor: 'test',
      evidence: { source: 'policy' },
    });
    const approved = await documents.transition(review.id, {
      expected_revision: review.revision,
      to: 'approved',
      intent: 'Approve the stable-link design.',
      actor: 'test',
      evidence: { source: 'policy' },
    });
    const successor = await documents.version(approved.id, {
      expected_revision: approved.revision,
      title: 'Second architecture version',
    });
    await expect(documents.validate(undefined, {}, { crossDomain: true })).resolves.toMatchObject({ valid: true });
    await documents.archive(successor.id, successor.revision);
    await expect(documents.validate(undefined, {}, { crossDomain: true })).resolves.toMatchObject({ valid: true });
    const archived = await documents.get(successor.id);
    await documents.restore(successor.id, archived.revision);
    await expect(documents.validate(undefined, {}, { crossDomain: true })).resolves.toMatchObject({ valid: true });
  });

  it('chunks more than the target address limit while preserving duplicate order and cardinality', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'neottia-composition-chunks-'));
    roots.push(cwd);
    const designDocsConfigOverrides = {
      enabled: true,
      security: { limits: { max_results: 2 } },
    } as const;
    const composition = createIssuesDesignDocsComposition({ cwd, designDocsConfigOverrides });
    const documents = await DesignDocumentStore.fromConfig(loadDesignDocsConfig(cwd, designDocsConfigOverrides), cwd);
    const document = await documents.create({ title: 'Known address', kind: 'hld' });
    const distinct = [
      { kind: 'design-doc' as const, id: document.id },
      { kind: 'design-doc' as const, id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAW' },
      { kind: 'design-doc' as const, id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAX', version: 3 },
    ];
    const references = Array.from({ length: 205 }, (_, index) => distinct[index % distinct.length]!);
    const root = await resolveManagedRoot({ authorityRoot: cwd, limits: DEFAULT_STORE_LIMITS });
    const batch = await withRepositoryLease(root, (lease) => composition.resolver.resolveMany(references, { lease }));
    expect(batch.status).toBe('ok');
    if (batch.status !== 'ok') throw new Error('Expected a resolved address batch.');
    expect(batch.results).toHaveLength(references.length);
    expect(batch.results.map((result) => result.reference)).toEqual(references);
    expect(batch.results.filter((result) => result.status === 'resolved')).toHaveLength(69);
  });

  it('reports missing stable IDs and pinned versions from canonical Issues', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'neottia-composition-missing-'));
    roots.push(cwd);
    const composition = createIssuesDesignDocsComposition({
      cwd,
      issuesConfigOverrides: { enabled: true },
      designDocsConfigOverrides: { enabled: true },
    });
    const documents = await DesignDocumentStore.fromConfig(loadDesignDocsConfig(cwd, { enabled: true }), cwd, {
      linkValidator: composition.linkValidator,
    });
    const issues = new IssueStore(loadIssueConfig(cwd, { enabled: true }), cwd, { resolver: composition.resolver });
    const document = await documents.create({ title: 'Known document', kind: 'hld' });
    await issues.create({ type: 'task', title: 'Out-of-band canonical links' });
    const issueRoot = join(cwd, '.neottia/issues');
    const filename = (await readdir(issueRoot)).find((entry) => /\.ya?ml$/u.test(entry));
    if (!filename) throw new Error('Expected a canonical issue file.');
    const path = join(issueRoot, filename);
    const decoded = decodeIssue(await readFile(path));
    await writeFile(
      path,
      encodeIssue({
        ...decoded.record,
        links: [
          { kind: 'design-doc', id: document.id, version: 99 },
          { kind: 'design-doc', id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAW' },
        ],
      }),
    );
    const report = await documents.validate(undefined, {}, { crossDomain: true });
    expect(report.findings.map((finding) => finding.code)).toEqual([
      'ISSUE_LINK_ID_NOT_FOUND',
      'ISSUE_LINK_VERSION_NOT_FOUND',
    ]);
    expect(report.findings.every((finding) => /\.ya?ml$/u.test(finding.path ?? ''))).toBe(true);
  });

  it('fails closed when Issues is disabled without creating its managed root', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'neottia-composition-disabled-'));
    roots.push(cwd);
    const composition = createIssuesDesignDocsComposition({ cwd });
    const documents = await DesignDocumentStore.fromConfig(loadDesignDocsConfig(cwd, { enabled: true }), cwd, {
      linkValidator: composition.linkValidator,
    });
    await documents.create({ title: 'Document', kind: 'hld' });
    const report = await documents.validate(undefined, {}, { crossDomain: true });
    expect(report.findings).toContainEqual(
      expect.objectContaining({ category: 'synchronization', code: 'ISSUES_DISABLED' }),
    );
  });
});
