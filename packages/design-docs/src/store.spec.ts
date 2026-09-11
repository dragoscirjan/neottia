import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveManagedRoot, withRepositoryLease, DEFAULT_STORE_LIMITS } from '@neottia/repository-store';
import { afterEach, describe, expect, it } from 'vitest';
import { designDocsConfigSchema } from './config.js';
import { DesignDocumentStore } from './store.js';

const roots: string[] = [];
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'neottia-design-docs-'));
  roots.push(root);
  return root;
}
function config() {
  return designDocsConfigSchema.parse({ enabled: true, cache: { max_age_ms: 300_000, stale_policy: 'rebuild' } });
}
function clock() {
  let tick = Date.parse('2026-01-01T00:00:00.000Z');
  return () => new Date(tick++);
}
const id = 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV';
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('DesignDocumentStore lifecycle', () => {
  it('enforces draft-review-approved, immutable approval, and approved-only successor', async () => {
    const root = await project();
    const store = await DesignDocumentStore.fromConfig(config(), root, { clock: clock(), generateId: () => id });
    const draft = await store.create({ title: 'Search Design', kind: 'hld', body: 'SQLite full text search.' });
    expect(draft.metadata.status).toBe('draft');
    await expect(store.version(id, { expected_revision: draft.revision })).rejects.toMatchObject({
      code: 'VERSION_REQUIRES_APPROVED',
    });
    const review = await store.transition(id, {
      expected_revision: draft.revision,
      to: 'review',
      intent: 'request technical review',
      actor: 'agent',
      evidence: { source: 'caller-attestation', note: 'Review requested.' },
    });
    const approved = await store.transition(id, {
      expected_revision: review.revision,
      to: 'approved',
      intent: 'record approval',
      actor: 'maintainer',
      evidence: { source: 'policy', reference: 'policy/design-review' },
    });
    await expect(store.update(id, { expected_revision: approved.revision, body: 'changed' })).rejects.toMatchObject({
      code: 'APPROVED_IMMUTABLE',
    });
    const successor = await store.version(id, {
      expected_revision: approved.revision,
      title: 'Search Design v2',
      body: 'Use FTS5 and BM25.',
    });
    expect(successor.metadata).toMatchObject({ version: 2, status: 'draft', created_at: draft.metadata.created_at });
    expect((await store.get(id, 1)).revision).toBe(approved.revision);
    await expect(store.update(id, { expected_revision: approved.revision, body: 'stale' })).rejects.toMatchObject({
      code: 'REVISION_MISMATCH',
    });
  });

  it('searches through isolated FTS5, moves complete lineages, and hydrates archived hits', async () => {
    const root = await project();
    const store = await DesignDocumentStore.fromConfig(config(), root, { clock: clock(), generateId: () => id });
    let record = await store.create({
      title: 'Retrieval Architecture',
      kind: 'lld',
      body: 'SQLite FTS5 with deterministic BM25 ranking.',
    });
    record = await store.transition(id, {
      expected_revision: record.revision,
      to: 'review',
      intent: 'review',
      actor: 'a',
      evidence: { source: 'caller-attestation' },
    });
    record = await store.transition(id, {
      expected_revision: record.revision,
      to: 'approved',
      intent: 'approve',
      actor: 'a',
      evidence: { source: 'policy' },
    });
    const hits = await store.search({ query: 'SQLite' });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id, version: 1, location: 'active' });
    const archived = await store.archive(id, record.revision);
    expect(archived.documents.every((item) => item.location === 'archive')).toBe(true);
    expect((await store.get(id)).location).toBe('archive');
    const archivedHits = await store.search({ query: 'SQLite', location: 'archive' });
    expect(archivedHits[0]?.id).toBe(id);
    await store.restore(id, archived.documents.at(-1)!.revision);
    expect((await store.get(id)).location).toBe('active');
  });

  it('rebuilds and searches a valid near-file-limit document projection', async () => {
    const root = await project();
    const nearLimitConfig = designDocsConfigSchema.parse({
      enabled: true,
      cache: { max_age_ms: 300_000, stale_policy: 'rebuild' },
      security: {
        limits: {
          max_file_bytes: 1_110_000,
          max_body_bytes: 1_050_000,
          max_aggregate_bytes: 4_000_000,
          max_result_bytes: 2_000_000,
        },
      },
    });
    const store = await DesignDocumentStore.fromConfig(nearLimitConfig, root, {
      clock: clock(),
      generateId: () => id,
    });
    await store.create({
      title: 'Near parameter boundary',
      kind: 'hld',
      body: `parameterneedle ${'x'.repeat(1_049_000)}`,
    });
    expect((await store.search({ query: 'parameterneedle' })).map((hit) => hit.id)).toEqual([id]);
  });

  it('exports exact bytes and previews/imports without touching legacy authority paths', async () => {
    const sourceRoot = await project();
    const source = await DesignDocumentStore.fromConfig(config(), sourceRoot, { clock: clock(), generateId: () => id });
    await source.create({
      title: 'Portable Bundle',
      kind: 'gdd',
      body: 'Portable exact content.',
      metadata: { legacy: true },
    });
    const bundle = await source.export();
    // Genuine harnessctl-v2 bytes preserve metadata insertion order rather than sorting it.
    const legacySource = `${[
      '---',
      `id: ${JSON.stringify(id)}`,
      'title: "Portable Legacy Bundle"',
      'kind: gdd',
      'status: draft',
      'version: 1',
      'created_at: "2026-01-01T00:00:00.000Z"',
      'updated_at: "2026-01-01T00:00:00.000Z"',
      'metadata: {"z":1,"nested":{"z":2,"a":1},"a":2}',
      '---',
      '',
      '# Portable Legacy Bundle',
      '',
      'Portable exact content.',
    ].join('\n')}\n`;
    const legacyBundle = JSON.stringify({
      version: 1,
      format: 'harnessctl-v2-design-documents',
      documents: [{ path: '.harnessctl/documents/doc-00001-portable-legacy-bundle-v1.md', content: legacySource }],
    });
    const targetRoot = await project();
    const target = await DesignDocumentStore.fromConfig(config(), targetRoot, { clock: clock() });
    const preview = await target.import({ content: legacyBundle, preview: true, format: 'harnessctl-v2' });
    expect(preview).toMatchObject({ preview: true, valid: true, additions: 1, path_mappings: [{ id, version: 1 }] });
    await expect(readdir(join(targetRoot, '.neottia/design-docs'))).rejects.toThrow();
    const imported = await target.import({ content: legacyBundle, preview: false, format: 'harnessctl-v2' });
    expect(imported.valid).toBe(true);
    const importedRecord = await target.get(id);
    expect(importedRecord.body).toContain('Portable exact content.');
    expect(await readFile(join(targetRoot, importedRecord.path), 'utf8')).toContain(
      'metadata: {"a":2,"nested":{"a":1,"z":2},"z":1}',
    );
    await expect(readdir(join(targetRoot, '.harnessctl'))).rejects.toThrow();

    const nativeTargetRoot = await project();
    const nativeTarget = await DesignDocumentStore.fromConfig(config(), nativeTargetRoot);
    expect((await nativeTarget.import({ content: bundle, preview: false })).valid).toBe(true);
  });

  it('resolves latest and pinned addresses under an existing same-authority lease', async () => {
    const root = await project();
    const store = await DesignDocumentStore.fromConfig(config(), root, { clock: clock(), generateId: () => id });
    const record = await store.create({ title: 'Linked', kind: 'design-overview' });
    const externalRoot = await resolveManagedRoot({
      authorityRoot: root,
      managedPath: '.neottia/issues',
      limits: DEFAULT_STORE_LIMITS,
    });
    const batch = await withRepositoryLease(externalRoot, (lease) =>
      store.resolveAddressesUnderLease([{ id }, { id, version: 2 }], lease),
    );
    expect(batch).toMatchObject({
      status: 'ok',
      results: [
        { status: 'found', revision: record.revision },
        { status: 'not_found', reason: 'version_not_found' },
      ],
    });
  });

  it('serializes overlapping independent in-process writers', async () => {
    const root = await project();
    const first = await DesignDocumentStore.fromConfig(config(), root, {
      generateId: () => 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV',
    });
    const second = await DesignDocumentStore.fromConfig(config(), root, {
      generateId: () => 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAW',
    });
    const attempts = await Promise.allSettled([
      first.create({ title: 'First writer', kind: 'hld' }),
      second.create({ title: 'Second writer', kind: 'lld' }),
    ]);
    expect(attempts.every((attempt) => attempt.status === 'fulfilled')).toBe(true);
    expect(await first.list()).toHaveLength(2);
  });

  it('validates direct transition evidence and supports explicit cross-domain findings', async () => {
    const root = await project();
    const store = await DesignDocumentStore.fromConfig(config(), root, {
      clock: clock(),
      generateId: () => id,
      linkValidator: async (snapshot) => {
        const batch = await snapshot.resolveAddresses([{ id }, { id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAA' }]);
        expect(batch.status).toBe('ok');
        return [
          {
            category: 'synchronization',
            code: 'ISSUE_LINK_UNRESOLVED',
            message: 'Issue references an unknown design document.',
          },
        ];
      },
    });
    const record = await store.create({ title: 'Linked', kind: 'hld' });
    await expect(
      store.transition(id, {
        expected_revision: record.revision,
        to: 'review',
        intent: 'x',
        actor: 'a',
        evidence: { source: 'forged' as never },
      }),
    ).rejects.toMatchObject({ code: 'DOMAIN_INPUT_INVALID' });
    const report = await store.validate(undefined, {}, { crossDomain: true });
    expect(report).toMatchObject({ valid: false, findings: [{ code: 'ISSUE_LINK_UNRESOLVED' }] });
  });

  it('reports an invalid injected clock through the domain error contract', async () => {
    const root = await project();
    const store = await DesignDocumentStore.fromConfig(config(), root, {
      clock: () => new Date(Number.NaN),
      generateId: () => id,
    });
    await expect(store.create({ title: 'Invalid clock', kind: 'hld' })).rejects.toMatchObject({
      code: 'TIMESTAMP_INVALID',
    });
  });

  it('fails a disabled capability before creating .neottia', async () => {
    const root = await project();
    await expect(
      DesignDocumentStore.fromConfig(designDocsConfigSchema.parse({ enabled: false }), root),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' });
    await expect(readdir(join(root, '.neottia'))).rejects.toThrow();
  });
});
