import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeIssue, encodeIssue, issueFilename } from './codec.js';
import { issueConfigSchema } from './config.js';
import type { DesignDocumentReferenceResolver } from './resolver.js';
import { IssueStore } from './store.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'neottia-issues-'));
  roots.push(root);
  return root;
}
function store(cwd: string): IssueStore {
  return new IssueStore(issueConfigSchema.parse({ enabled: true, cache: { stale_policy: 'rebuild' } }), cwd);
}

describe('issue canonical lifecycle', () => {
  it('creates canonical YAML, enforces exact revisions, renames, archives, and restores', async () => {
    const cwd = project();
    const issues = store(cwd);
    const created = await issues.create({ type: 'initiative', title: 'Road Map', body: 'searchable launch plan' });
    expect(created.id).toMatch(/^issue-[0-9A-HJKMNP-TV-Z]{26}$/u);
    const path = join(cwd, '.neottia/issues', issueFilename(created.id, created.title));
    const decoded = decodeIssue(readFileSync(path), 'issue-', created.id);
    expect(decoded.canonical).toBe(true);
    await expect(issues.update(created.id, `v1:${'0'.repeat(64)}`, { title: 'Wrong' })).rejects.toMatchObject({
      code: 'STALE_REVISION',
    });
    const updated = await issues.update(created.id, created.revision, { title: 'Shipping Roadmap' });
    expect(updated.id).toBe(created.id);
    expect(() => readFileSync(path)).toThrow();
    const archived = await issues.archive(updated.id, updated.revision);
    expect(archived[0]?.location).toBe('archive');
    const restored = await issues.restore(updated.id, archived[0]!.revision);
    expect(restored[0]?.location).toBe('active');
  });

  it('rejects unpaired surrogate input before canonical YAML encoding', async () => {
    const issues = store(project());
    await expect(issues.create({ type: 'task', title: `Invalid\ud800` })).rejects.toMatchObject({
      code: 'UNICODE_INVALID',
    });
  });

  it('derives hierarchy/relationships and searches canonical hydrated records', async () => {
    const cwd = project();
    const issues = store(cwd);
    const initiative = await issues.create({ type: 'initiative', title: 'Platform' });
    const epic = await issues.create({
      type: 'epic',
      title: 'Indexing',
      parent: initiative.id,
      body: 'SQLite ranking',
    });
    const related = await issues.relate({ source_id: epic.id, target_id: initiative.id, relationship: 'depends_on' });
    expect(related.blocked_by).toEqual([initiative.id]);
    expect((await issues.get(initiative.id)).blocks).toEqual([epic.id]);
    await issues.comment(epic.id, 'tester', 'BM25 comments are indexed');
    const found = await issues.search('BM25');
    expect(found.map((issue) => issue.id)).toContain(epic.id);
    const tokenized = await issues.create({ type: 'task', title: 'Café release', body: 'alpha beta rollout' });
    expect((await issues.search('cafe')).map((issue) => issue.id)).toContain(tokenized.id);
    expect((await issues.search('alpha-beta')).map((issue) => issue.id)).toContain(tokenized.id);
    expect((await issues.validate()).valid).toBe(true);
  });

  it('serializes concurrent comment appends without losing unrelated state', async () => {
    const cwd = project();
    const issues = store(cwd);
    const created = await issues.create({ type: 'task', title: 'Concurrent comments' });
    await Promise.all([
      issues.comment(created.id, 'one', 'first'),
      issues.comment(created.id, 'two', 'second'),
      issues.comment(created.id, 'three', 'third'),
    ]);
    expect((await issues.get(created.id)).comments.map((comment) => comment.body).sort()).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('rejects disabled calls before creating repository state', async () => {
    const cwd = project();
    const issues = new IssueStore(issueConfigSchema.parse({ enabled: false }), cwd);
    await expect(issues.list()).rejects.toMatchObject({ code: 'ISSUES_DISABLED' });
    expect(() => readFileSync(join(cwd, '.neottia/repository-store/host-id'))).toThrow();
  });

  it('preserves exact-byte revisions for safe manually formatted YAML', () => {
    const record = {
      version: 1 as const,
      id: 'issue-01ARZ3NDEKTSV4RRFFQ69G5FAV',
      type: 'task' as const,
      title: 'Manual',
      status: 'open' as const,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      depends_on: [],
      relates_to: [],
      duplicates: [],
      supersedes: [],
      body: '',
      metadata: {},
      comments: [],
      links: [],
    };
    const canonical = encodeIssue(record);
    const manual = Buffer.from(
      Buffer.from(canonical).toString('utf8').replace('version: 1', 'version: 1 # safe comment'),
    );
    const decoded = decodeIssue(manual);
    expect(decoded.canonical).toBe(false);
    expect(decoded.revision).not.toBe(decodeIssue(canonical).revision);
  });

  it('rejects contradictory cache filter and FTS projections', async () => {
    const cwd = project();
    const issues = store(cwd);
    const canonical = await issues.create({ type: 'bug', title: 'Cache authority', body: 'hydrate canonical only' });
    const unrelated = await issues.create({ type: 'task', title: 'Other issue', body: 'nothing relevant' });
    await issues.search('canonical');
    const database = new DatabaseSync(join(cwd, '.neottia/cache/issues.sqlite'));
    database.exec(`UPDATE issues SET status='closed' WHERE id='${canonical.id}'`);
    database.exec(`UPDATE issue_fts SET body='canonical forged match' WHERE issue_id='${unrelated.id}'`);
    database.close();
    const matches = await issues.search('canonical', { status: 'open' });
    expect(matches.map((issue) => issue.id)).toEqual([canonical.id]);
    writeFileSync(join(cwd, '.neottia/cache/issues.sqlite'), 'corrupt');
    expect((await issues.search('canonical')).map((issue) => issue.id)).toEqual([canonical.id]);
  });

  it('bounds hydrated list/search/export output rather than cache candidates', async () => {
    const cwd = project();
    const config = issueConfigSchema.parse({
      enabled: true,
      cache: { stale_policy: 'rebuild' },
      security: { max_result_bytes: 800 },
    });
    const issues = new IssueStore(config, cwd);
    await issues.create({ type: 'task', title: 'Large', body: `needle ${'x'.repeat(2000)}` });
    await expect(issues.list()).rejects.toMatchObject({ code: 'RESULT_TOO_LARGE' });
    await expect(issues.search('needle', { maxBytes: 800 })).rejects.toMatchObject({ code: 'RESULT_TOO_LARGE' });
    await expect(issues.export()).rejects.toMatchObject({ code: 'RESULT_TOO_LARGE' });
  });

  it('rebuilds and searches a valid near-file-limit issue projection', async () => {
    const cwd = project();
    const config = issueConfigSchema.parse({
      enabled: true,
      cache: { stale_policy: 'rebuild' },
      retrieval: { max_bytes: 2_000_000 },
      security: { max_file_bytes: 1_100_000, max_total_bytes: 4_000_000, max_result_bytes: 2_000_000 },
    });
    const issues = new IssueStore(config, cwd);
    const created = await issues.create({
      type: 'task',
      title: 'Near parameter boundary',
      body: `parameterneedle ${'x'.repeat(1_048_560)}`,
    });
    expect((await issues.search('parameterneedle')).map((issue) => issue.id)).toEqual([created.id]);
  });

  it('imports legacy decimal identities, comments, and resolver-mapped links', async () => {
    const cwd = project();
    const resolver: DesignDocumentReferenceResolver = {
      async importLegacyPath() {
        return { kind: 'design-doc', id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV' };
      },
      async resolveMany(references) {
        return {
          status: 'ok',
          results: references.map((reference) => ({
            status: 'resolved',
            reference,
            resolvedVersion: 1,
            location: 'archive',
            revision: `sha256:${'0'.repeat(64)}`,
          })),
        };
      },
    };
    const issues = new IssueStore(issueConfigSchema.parse({ enabled: true }), cwd, { resolver });
    const legacy = `version: 1\nid: "00007"\ntype: task\ntitle: Legacy\nstatus: open\ncreated_at: 2026-08-14T13:43:36.998Z\nupdated_at: 2026-08-14T13:44:55.251Z\ndocuments: [.specs/hld-00004.yml]\nbody: preserved\ncomments:\n  - id: 00007-C0001\n    created_at: 2026-08-14T13:45:00.000Z\n    created_by: reviewer\n    body: Preserve this comment.\n`;
    const preview = await issues.import(legacy, true);
    expect(preview).toMatchObject({ valid: true, imported: 0, planned: 1 });
    expect(preview.warnings[0]).toContain('Mapped legacy document path');
    expect((await issues.import(legacy, false)).valid).toBe(true);
    const imported = await issues.get('00007');
    expect(imported.comments[0]).toMatchObject({ id: '00007-C0001', author: 'reviewer' });
    expect(imported.links[0]).toMatchObject({ id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV' });
  });

  it('returns deterministic symmetric owner evidence for removal', async () => {
    const cwd = project();
    const issues = store(cwd);
    const first = await issues.create({ type: 'task', title: 'First' });
    const second = await issues.create({ type: 'task', title: 'Second' });
    const [owner, other] = first.id < second.id ? [first, second] : [second, first];
    const relatedOwner = await issues.relate({ source_id: other.id, target_id: owner.id, relationship: 'relates_to' });
    expect(relatedOwner.id).toBe(owner.id);
    const removedOwner = await issues.unrelate({
      source_id: other.id,
      target_id: owner.id,
      relationship: 'relates_to',
      expected_revision: relatedOwner.revision,
    });
    expect(removedOwner.id).toBe(owner.id);
    expect(removedOwner.related_to).toEqual([]);
  });

  it('canonicalizes nested metadata mappings inside arrays', () => {
    const base = {
      version: 1 as const,
      id: 'issue-01ARZ3NDEKTSV4RRFFQ69G5FAV',
      type: 'task' as const,
      title: 'Metadata',
      status: 'open' as const,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      depends_on: [],
      relates_to: [],
      duplicates: [],
      supersedes: [],
      body: '',
      comments: [],
      links: [],
    };
    expect(encodeIssue({ ...base, metadata: { items: [{ b: 1, a: 2 }] } })).toEqual(
      encodeIssue({ ...base, metadata: { items: [{ a: 2, b: 1 }] } }),
    );
  });

  it('recovers an interrupted recursive archive without a partial subtree', async () => {
    const cwd = project();
    const issues = new IssueStore(issueConfigSchema.parse({ enabled: true, lock: { stale_ms: 1 } }), cwd);
    const parent = await issues.create({ type: 'initiative', title: 'Crash parent' });
    await issues.create({ type: 'epic', title: 'Crash child', parent: parent.id });
    const worker = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./archive-crash.fixture.ts', import.meta.url)),
        cwd,
        parent.id,
        parent.revision,
        'canonical-path-published',
      ],
      { encoding: 'utf8' },
    );
    expect(worker.status).toBe(86);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    const afterRecovery = await issues.list({ limit: 10 });
    expect(afterRecovery).toHaveLength(2);
    expect(new Set(afterRecovery.map((issue) => issue.location))).toEqual(new Set(['active']));
    expect((await issues.validate()).valid).toBe(true);
  });

  it('fails closed on symlinked issue roots and proposed resource overflow', async () => {
    const cwd = project();
    mkdirSync(join(cwd, '.neottia'), { recursive: true });
    symlinkSync(join(cwd, 'outside'), join(cwd, '.neottia/issues'));
    await expect(store(cwd).list()).rejects.toMatchObject({ code: 'UNSAFE_LINK' });

    const boundedCwd = project();
    const bounded = new IssueStore(issueConfigSchema.parse({ enabled: true, security: { max_files: 1 } }), boundedCwd);
    await bounded.create({ type: 'task', title: 'One' });
    await expect(bounded.create({ type: 'task', title: 'Two' })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(await bounded.list()).toHaveLength(1);
  });

  it('reports multiple malformed canonical files with actionable paths', async () => {
    const cwd = project();
    mkdirSync(join(cwd, '.neottia/issues'), { recursive: true });
    writeFileSync(join(cwd, '.neottia/issues/issue-01ARZ3NDEKTSV4RRFFQ69G5FAV-first.yml'), 'bad: one\n');
    writeFileSync(join(cwd, '.neottia/issues/issue-01ARZ3NDEKTSV4RRFFQ69G5FAW-second.yml'), 'bad: two\n');
    const validation = await store(cwd).validate();
    expect(validation.valid).toBe(false);
    expect(validation.findings).toHaveLength(2);
    expect(validation.findings.every((finding) => finding.path?.endsWith('.yml'))).toBe(true);
  });

  it('rejects whitespace search before SQLite and cancels queued waiters', async () => {
    const cwd = project();
    const resolver: DesignDocumentReferenceResolver = {
      async resolveMany() {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        return { status: 'ok', results: [] };
      },
    };
    const issues = new IssueStore(issueConfigSchema.parse({ enabled: true }), cwd, { resolver });
    await expect(issues.search('   ')).rejects.toBeDefined();
    const created = await issues.create({ type: 'task', title: 'Queue' });
    const blocker = issues.linkDocument(created.id, { kind: 'design-doc', id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV' });
    const controller = new AbortController();
    const queued = issues.get(created.id, { signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(blocker).rejects.toMatchObject({ code: 'LINK_UNRESOLVED' });
  });
});
