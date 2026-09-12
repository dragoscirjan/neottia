import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeIssue, encodeIssue, issueFilename } from './codec.js';
import { issueConfigSchema } from './config.js';
import type { DesignDocumentReferenceResolver } from './resolver.js';
import { IssueStore } from './store.js';
import { issueSearchInputSchema } from './tool-contracts.js';

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
            revision: `v1:${'0'.repeat(64)}`,
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

  it('clamps direct search budgets to security ceilings before SQLite', async () => {
    const cwd = project();
    const issues = new IssueStore(
      issueConfigSchema.parse({
        enabled: true,
        cache: { stale_policy: 'rebuild' },
        security: { max_query_rows: 1, max_result_bytes: 1000 },
      }),
      cwd,
    );
    await issues.create({ type: 'task', title: 'Needle one', body: 'needle' });
    await issues.create({ type: 'task', title: 'Needle two', body: 'needle' });
    expect(await issues.search('needle', { limit: 2, maxBytes: 10_000 })).toHaveLength(1);

    const large = new IssueStore(
      issueConfigSchema.parse({
        enabled: true,
        root: '.neottia/large-issues',
        cache: { stale_policy: 'rebuild' },
        security: { max_result_bytes: 1000 },
      }),
      cwd,
    );
    await large.create({ type: 'task', title: 'Budget', body: `budget ${'x'.repeat(700)}` });
    await expect(large.search('budget')).rejects.toMatchObject({ code: 'RESULT_TOO_LARGE' });
    await expect(large.search('budget', { maxBytes: 10_000 })).rejects.toMatchObject({ code: 'RESULT_TOO_LARGE' });
  });

  it('rejects malformed direct search budgets before opening the cache', async () => {
    const paddedCwd = project();
    const boundedQueryStore = new IssueStore(
      issueConfigSchema.parse({ enabled: true, security: { max_query_bytes: 16 } }),
      paddedCwd,
    );
    await expect(boundedQueryStore.search(`${' '.repeat(16)}x`)).rejects.toMatchObject({ code: 'QUERY_TOO_LARGE' });
    expect(existsSync(join(paddedCwd, '.neottia/cache/issues.sqlite'))).toBe(false);
    expect(issueSearchInputSchema.safeParse({ query: `${' '.repeat(16 * 1024)}x` }).success).toBe(false);

    for (const field of ['limit', 'maxBytes'] as const)
      for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
        const cwd = project();
        const issues = store(cwd);
        await expect(issues.search('needle', { [field]: value })).rejects.toMatchObject({
          code: 'SEARCH_BUDGET_INVALID',
          details: { field },
        });
        expect(existsSync(join(cwd, '.neottia/cache/issues.sqlite'))).toBe(false);
      }
  });

  it('revalidates idempotent document links before preserving canonical bytes', async () => {
    const cwd = project();
    const reference = { kind: 'design-doc' as const, id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV' };
    const resolving: DesignDocumentReferenceResolver = {
      async resolveMany(references) {
        return {
          status: 'ok',
          results: references.map((item) => ({
            status: 'resolved' as const,
            reference: item,
            resolvedVersion: 1,
            location: 'active' as const,
            revision: `v1:${'0'.repeat(64)}` as const,
          })),
        };
      },
    };
    const configured = issueConfigSchema.parse({ enabled: true });
    const linkedStore = new IssueStore(configured, cwd, { resolver: resolving });
    const created = await linkedStore.create({ type: 'task', title: 'Linked no-op' });
    const linked = await linkedStore.linkDocument(created.id, reference);
    const path = join(cwd, '.neottia/issues', issueFilename(linked.id, linked.title));
    const before = readFileSync(path);
    await expect(new IssueStore(configured, cwd).linkDocument(linked.id, reference)).rejects.toMatchObject({
      code: 'RESOLVER_UNAVAILABLE',
    });
    expect(readFileSync(path)).toEqual(before);
  });

  it('validates the complete reference snapshot and preserves unresolved evidence', async () => {
    const cwd = project();
    const firstReference = { kind: 'design-doc' as const, id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV' };
    const secondReference = { kind: 'design-doc' as const, id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAW', version: 2 };
    const resolving: DesignDocumentReferenceResolver = {
      async resolveMany(references) {
        return {
          status: 'ok',
          results: references.map((reference) => ({
            status: 'resolved' as const,
            reference,
            resolvedVersion: reference.version ?? 1,
            location: 'active' as const,
            revision: `v1:${'0'.repeat(64)}` as const,
          })),
        };
      },
    };
    const config = issueConfigSchema.parse({ enabled: true });
    const seeded = new IssueStore(config, cwd, { resolver: resolving });
    const first = await seeded.create({ type: 'task', title: 'First link' });
    const firstLinked = await seeded.linkDocument(first.id, firstReference);
    const second = await seeded.create({ type: 'task', title: 'Second link' });
    await seeded.linkDocument(second.id, secondReference);
    let observed: readonly { id: string }[] = [];
    const unresolved: DesignDocumentReferenceResolver = {
      async resolveMany(references) {
        observed = references;
        return {
          status: 'ok',
          results: references.map((reference) =>
            reference.id === secondReference.id
              ? { status: 'unresolved' as const, reference, reason: 'version_not_found' as const }
              : {
                  status: 'resolved' as const,
                  reference,
                  resolvedVersion: 1,
                  location: 'active' as const,
                  revision: `v1:${'0'.repeat(64)}` as const,
                },
          ),
        };
      },
    };
    await expect(
      new IssueStore(config, cwd, { resolver: unresolved }).linkDocument(first.id, firstReference),
    ).rejects.toMatchObject({
      code: 'LINK_UNRESOLVED',
      details: {
        unresolved: [{ reference: secondReference, reason: 'version_not_found' }],
        referenceCount: 2,
      },
    });
    expect(observed.map((reference) => reference.id)).toEqual([firstReference.id, secondReference.id]);
    expect((await seeded.get(first.id)).revision).toBe(firstLinked.revision);
  });

  it('canonicalizes explicit semantic no-op writes without changing updated_at', async () => {
    const cwd = project();
    const issues = store(cwd);
    const created = await issues.create({ type: 'task', title: 'Canonical repair', body: 'same body' });
    const path = join(cwd, '.neottia/issues', issueFilename(created.id, created.title));
    const manual = Buffer.from(readFileSync(path, 'utf8').replace('version: 1', 'version: 1 # operator comment'));
    writeFileSync(path, manual);
    const manualIssue = decodeIssue(manual, 'issue-', created.id);
    expect(manualIssue.canonical).toBe(false);
    const repaired = await issues.update(created.id, manualIssue.revision, { body: created.body });
    expect(readFileSync(path)).toEqual(Buffer.from(encodeIssue(manualIssue.record)));
    expect(repaired.revision).not.toBe(manualIssue.revision);
    expect(repaired.updated_at).toBe(created.updated_at);
    const canonicalBefore = readFileSync(path);
    const unchanged = await issues.update(repaired.id, repaired.revision, { body: repaired.body });
    expect(unchanged.revision).toBe(repaired.revision);
    expect(readFileSync(path)).toEqual(canonicalBefore);
  });

  it('treats reordered nested metadata as a semantic no-op', async () => {
    const issues = store(project());
    const created = await issues.create({
      type: 'task',
      title: 'Metadata no-op',
      metadata: { top: { alpha: 1, beta: { left: true, right: false } } },
    });
    const unchanged = await issues.update(created.id, created.revision, {
      metadata: { top: { beta: { right: false, left: true }, alpha: 1 } },
    });
    expect(unchanged.revision).toBe(created.revision);
    expect(unchanged.updated_at).toBe(created.updated_at);
  });

  it('canonicalizes an idempotent relation write', async () => {
    const cwd = project();
    const issues = store(cwd);
    const source = await issues.create({ type: 'task', title: 'Relation owner' });
    const target = await issues.create({ type: 'task', title: 'Relation target' });
    const related = await issues.relate({ source_id: source.id, target_id: target.id, relationship: 'depends_on' });
    const path = join(cwd, '.neottia/issues', issueFilename(related.id, related.title));
    const manual = Buffer.from(readFileSync(path, 'utf8').replace('version: 1', 'version: 1 # manual'));
    writeFileSync(path, manual);
    const revision = decodeIssue(manual, 'issue-', related.id).revision;
    const repaired = await issues.relate({
      source_id: source.id,
      target_id: target.id,
      relationship: 'depends_on',
      expected_revision: revision,
    });
    expect(decodeIssue(readFileSync(path), 'issue-', related.id).canonical).toBe(true);
    expect(repaired.updated_at).toBe(related.updated_at);
    expect(repaired.revision).not.toBe(revision);
  });

  it('projects and health-checks structured canonical issue state', async () => {
    const cwd = project();
    const reference = { kind: 'design-doc' as const, id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV', version: 3 };
    const resolver: DesignDocumentReferenceResolver = {
      async resolveMany(references) {
        return {
          status: 'ok',
          results: references.map((item) => ({
            status: 'resolved' as const,
            reference: item,
            resolvedVersion: item.version ?? 1,
            location: 'active' as const,
            revision: `v1:${'0'.repeat(64)}` as const,
          })),
        };
      },
    };
    const issues = new IssueStore(issueConfigSchema.parse({ enabled: true, cache: { stale_policy: 'rebuild' } }), cwd, {
      resolver,
    });
    const parent = await issues.create({ type: 'epic', title: 'Projection parent' });
    let child = await issues.create({
      type: 'task',
      title: 'Projection child',
      parent: parent.id,
      metadata: { nested: { count: 2 }, labels: ['one', 'two'] },
    });
    child = await issues.relate({ source_id: child.id, target_id: parent.id, relationship: 'depends_on' });
    child = await issues.comment(child.id, 'reviewer', 'Structured comment', child.revision);
    child = await issues.linkDocument(child.id, reference, child.revision);
    await issues.search('Projection');
    const path = join(cwd, '.neottia/cache/issues.sqlite');
    let database = new DatabaseSync(path);
    expect(database.prepare('SELECT revision,parent FROM issues WHERE id=?').get(child.id)).toMatchObject({
      revision: child.revision,
      parent: parent.id,
    });
    expect(database.prepare('SELECT value_json FROM issue_metadata WHERE issue_id=?').get(child.id)).toEqual({
      value_json: '{"labels":["one","two"],"nested":{"count":2}}',
    });
    expect(database.prepare('SELECT parent_id FROM issue_hierarchy WHERE issue_id=?').get(child.id)).toEqual({
      parent_id: parent.id,
    });
    expect(
      database.prepare('SELECT relationship,target_id FROM issue_relationships WHERE source_id=?').get(child.id),
    ).toEqual({
      relationship: 'depends_on',
      target_id: parent.id,
    });
    expect(database.prepare('SELECT author,body FROM issue_comments WHERE issue_id=?').get(child.id)).toEqual({
      author: 'reviewer',
      body: 'Structured comment',
    });
    expect(
      database.prepare('SELECT kind,target_id,target_version FROM issue_links WHERE issue_id=?').get(child.id),
    ).toEqual({
      kind: 'design-doc',
      target_id: reference.id,
      target_version: 3,
    });
    database.close();
    const corruptions = [
      `UPDATE issues SET revision='v1:${'0'.repeat(64)}' WHERE id='${child.id}'`,
      `UPDATE issue_metadata SET value_json='{}' WHERE issue_id='${child.id}'`,
      `DELETE FROM issue_hierarchy WHERE issue_id='${child.id}'`,
      `DELETE FROM issue_relationships WHERE source_id='${child.id}'`,
      `UPDATE issue_comments SET body='forged' WHERE issue_id='${child.id}'`,
      `UPDATE issue_links SET target_id='doc-01ARZ3NDEKTSV4RRFFQ69G5FAX' WHERE issue_id='${child.id}'`,
    ];
    for (const sql of corruptions) {
      database = new DatabaseSync(path);
      database.exec(sql);
      database.close();
      expect(await issues.validate()).toMatchObject({ valid: true, cache: 'rebuilt' });
    }
    database = new DatabaseSync(path);
    expect(database.prepare('SELECT value_json FROM issue_metadata WHERE issue_id=?').get(child.id)).toEqual({
      value_json: '{"labels":["one","two"],"nested":{"count":2}}',
    });
    database.close();
    expect((await issues.get(child.id)).metadata).toEqual({ nested: { count: 2 }, labels: ['one', 'two'] });
  });

  it('health-checks structured projections across multiple keyset pages', async () => {
    const cwd = project();
    const id = 'issue-01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const timestamp = '2026-01-01T00:00:00.000Z';
    const record = {
      version: 1 as const,
      id,
      type: 'task' as const,
      title: 'Multipage cache',
      status: 'open' as const,
      created_at: timestamp,
      updated_at: timestamp,
      depends_on: [],
      relates_to: [],
      duplicates: [],
      supersedes: [],
      body: 'multipage projection',
      metadata: {},
      comments: Array.from({ length: 300 }, (_, index) => ({
        id: `${10_000 + index}-C0001`,
        author: 'tester',
        body: `Comment ${index}`,
        created_at: timestamp,
      })),
      links: [],
    };
    mkdirSync(join(cwd, '.neottia/issues'), { recursive: true });
    writeFileSync(join(cwd, '.neottia/issues', issueFilename(id, record.title)), encodeIssue(record));
    const issues = store(cwd);
    expect(await issues.search('multipage')).toHaveLength(1);
    expect(await issues.validate()).toMatchObject({ valid: true, cache: 'checked' });

    const cachePath = join(cwd, '.neottia/cache/issues.sqlite');
    const database = new DatabaseSync(cachePath);
    database.exec(`UPDATE issue_comments SET body='forged' WHERE issue_id='${id}' AND ordinal=200`);
    database.close();
    expect(await issues.validate()).toMatchObject({ valid: true, cache: 'rebuilt' });

    const controller = new AbortController();
    controller.abort();
    await expect(issues.validate({ signal: controller.signal })).resolves.toMatchObject({
      valid: false,
      cache: 'skipped',
      findings: [expect.objectContaining({ code: 'ABORTED' })],
    });
  });

  it('returns stable structured cache and resolver-contract diagnostics', async () => {
    const cwd = project();
    const failStore = new IssueStore(issueConfigSchema.parse({ enabled: true, cache: { stale_policy: 'fail' } }), cwd);
    await failStore.create({ type: 'task', title: 'Missing cache' });
    await expect(failStore.search('Missing')).rejects.toMatchObject({
      code: 'ISSUE_CACHE_REBUILD_REQUIRED',
      details: { reason: 'missing' },
    });

    const ageConfig = issueConfigSchema.parse({
      enabled: true,
      root: '.neottia/age-issues',
      cache: { stale_policy: 'rebuild' },
    });
    const ageStore = new IssueStore(ageConfig, cwd);
    await ageStore.create({ type: 'task', title: 'Aged cache' });
    await ageStore.search('Aged');
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    const staleStore = new IssueStore(
      issueConfigSchema.parse({
        enabled: true,
        root: '.neottia/age-issues',
        cache: { stale_policy: 'fail', max_age_ms: 0 },
      }),
      cwd,
    );
    await expect(staleStore.search('Aged')).rejects.toMatchObject({
      code: 'ISSUE_CACHE_STALE',
      details: { reason: 'max-age', maxAgeMs: 0 },
    });

    const reference = { kind: 'design-doc' as const, id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV' };
    const malformed: DesignDocumentReferenceResolver = {
      async resolveMany() {
        return { status: 'ok', results: [] };
      },
    };
    const malformedStore = new IssueStore(issueConfigSchema.parse({ enabled: true, root: '.neottia/other' }), cwd, {
      resolver: malformed,
    });
    const issue = await malformedStore.create({ type: 'task', title: 'Resolver contract' });
    await expect(malformedStore.linkDocument(issue.id, reference)).rejects.toMatchObject({
      code: 'RESOLVER_RESULT_INVALID',
      details: { referenceCount: 1, resultCount: 0, expected: [reference] },
    });

    const missingResolvedFields: DesignDocumentReferenceResolver = {
      async resolveMany(references) {
        return {
          status: 'ok',
          results: [{ status: 'resolved', reference: references[0] }],
        } as never;
      },
    };
    await expect(
      new IssueStore(malformedStore.config, cwd, { resolver: missingResolvedFields }).linkDocument(issue.id, reference),
    ).rejects.toMatchObject({ code: 'RESOLVER_RESULT_INVALID', details: { issueCount: 3 } });

    const invalidStatus: DesignDocumentReferenceResolver = {
      async resolveMany() {
        return { status: 'unexpected' } as never;
      },
    };
    await expect(
      new IssueStore(malformedStore.config, cwd, { resolver: invalidStatus }).linkDocument(issue.id, reference),
    ).rejects.toMatchObject({ code: 'RESOLVER_RESULT_INVALID' });

    const targetInvalid: DesignDocumentReferenceResolver = {
      async resolveMany() {
        return {
          status: 'target_invalid',
          findings: Array.from({ length: 30 }, (_, index) => ({
            code: `DOC_${index}`,
            message: `Invalid document ${index}`,
            id: reference.id,
            version: index + 1,
          })),
        };
      },
    };
    const invalidStore = new IssueStore(
      issueConfigSchema.parse({ enabled: true, root: '.neottia/invalid-target' }),
      cwd,
      { resolver: targetInvalid },
    );
    const invalidIssue = await invalidStore.create({ type: 'task', title: 'Invalid target' });
    await expect(invalidStore.linkDocument(invalidIssue.id, reference)).rejects.toMatchObject({
      code: 'TARGET_INVALID',
      details: { targetStatus: 'target_invalid', findingCount: 30, findingsTruncated: true },
    });
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
    await expect(blocker).rejects.toMatchObject({ code: 'RESOLVER_RESULT_INVALID' });
  });
});
