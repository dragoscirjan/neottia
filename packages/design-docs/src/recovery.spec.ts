import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { designDocsConfigSchema } from './config.js';
import { DesignDocumentStore } from './store.js';
import { setTransactionFaultInjectorForTests } from '../../repository-store/src/internal/fault-injection.js';

const roots: string[] = [];
const id = 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV';
afterEach(async () => {
  setTransactionFaultInjectorForTests(undefined);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Design Docs durable lineage recovery', () => {
  it('recovers an interruption after the active journal is published', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-recovery-'));
    roots.push(root);
    const store = await DesignDocumentStore.fromConfig(designDocsConfigSchema.parse({ enabled: true }), root, {
      generateId: () => id,
    });
    const record = await store.create({ title: 'Recoverable', kind: 'hld' });
    setTransactionFaultInjectorForTests((event) => {
      if (event === 'active-state-renamed') throw new Error('injected interruption');
    });
    await expect(store.archive(id, record.revision)).rejects.toThrow(/injected interruption/u);
    setTransactionFaultInjectorForTests(undefined);
    // Lease entry recovers the prepared transaction before discovering authority.
    expect((await store.get(id)).location).toBe('active');
  });

  it('rolls back a partially published canonical move', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-rollback-'));
    roots.push(root);
    const store = await DesignDocumentStore.fromConfig(designDocsConfigSchema.parse({ enabled: true }), root, {
      generateId: () => id,
    });
    const record = await store.create({ title: 'Rollback', kind: 'lld' });
    setTransactionFaultInjectorForTests((event, occurrence) => {
      if (event === 'canonical-path-published' && occurrence === 1) throw new Error('publication interruption');
    });
    await expect(store.archive(id, record.revision)).rejects.toThrow(/publication interruption/u);
    setTransactionFaultInjectorForTests(undefined);
    expect((await store.get(id)).location).toBe('active');
  });
});
