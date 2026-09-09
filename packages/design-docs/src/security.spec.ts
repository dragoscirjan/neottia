import { mkdtemp, readdir, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { designDocsConfigSchema } from './config.js';
import { assertDocumentId } from './identities.js';
import { DesignDocumentStore } from './store.js';

const roots: string[] = [];
const id = 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV';
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'design-security-'));
  roots.push(root);
  const store = await DesignDocumentStore.fromConfig(designDocsConfigSchema.parse({ enabled: true }), root, {
    generateId: () => id,
  });
  return { root, store };
}

describe('Design Docs catalog and identity safety', () => {
  it('rejects ULID overflow and bounded legacy identity overflow', () => {
    expect(() => assertDocumentId('doc-8ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toThrow();
    expect(() => assertDocumentId(`doc-${'1'.repeat(121)}`)).toThrow();
    expect(() => assertDocumentId('doc-00001')).not.toThrow();
  });

  it('fails closed on a symlink inserted into canonical storage', async () => {
    const { root, store } = await fixture();
    await store.create({ title: 'Safe', kind: 'hld' });
    const path = join(root, '.neottia/design-docs/unsafe.md');
    await symlink('/etc/passwd', path);
    await expect(store.list()).rejects.toMatchObject({ category: 'path_safety' });
    await unlink(path);
  });

  it('detects a lineage gap before any later mutation', async () => {
    const { root, store } = await fixture();
    let current = await store.create({ title: 'Lineage', kind: 'lld' });
    current = await store.transition(id, {
      expected_revision: current.revision,
      to: 'review',
      intent: 'review',
      actor: 'a',
      evidence: { source: 'policy' },
    });
    current = await store.transition(id, {
      expected_revision: current.revision,
      to: 'approved',
      intent: 'approve',
      actor: 'a',
      evidence: { source: 'policy' },
    });
    await store.version(id, { expected_revision: current.revision });
    const files = await readdir(join(root, '.neottia/design-docs'));
    await unlink(
      join(
        root,
        '.neottia/design-docs',
        files.find((file) => file.endsWith('-v1.md'))!,
      ),
    );
    await expect(store.list()).rejects.toMatchObject({ code: 'LINEAGE_GAP' });
  });
});
