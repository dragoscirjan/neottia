import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { designDocsConfigSchema } from './config.js';
import { DesignDocumentStore } from './store.js';

const roots: string[] = [];
const id = 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV';
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function fixture(overrides: Record<string, unknown> = {}, warm = true) {
  const root = await mkdtemp(join(tmpdir(), 'design-cache-'));
  roots.push(root);
  const config = designDocsConfigSchema.parse({
    enabled: true,
    cache: { stale_policy: 'rebuild', max_age_ms: 300_000 },
    ...overrides,
  });
  const store = await DesignDocumentStore.fromConfig(config, root, { generateId: () => id });
  await store.create({ title: 'Canonical Search', kind: 'hld', body: 'SQLite canonical hydration.' });
  if (warm) await store.search({ query: 'SQLite' });
  return { root, store };
}

describe('Design Docs disposable cache', () => {
  it('rebuilds malformed freshness and contradictory projection metadata', async () => {
    const { root, store } = await fixture();
    const path = join(root, '.neottia/cache/design-docs.sqlite');
    let database = new DatabaseSync(path);
    database.exec("UPDATE neottia_repository_cache_meta SET value='not-a-time' WHERE key='rebuilt_at';");
    database.close();
    expect(await store.search({ query: 'SQLite' })).toHaveLength(1);

    database = new DatabaseSync(path);
    database.exec("UPDATE records SET status='approved' WHERE id='doc-01ARZ3NDEKTSV4RRFFQ69G5FAV';");
    database.close();
    const hits = await store.search({ query: 'SQLite' });
    expect(hits[0]?.title).toBe('Canonical Search');
  });

  it('applies deterministic tie ordering and canonical metadata filters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-cache-order-'));
    roots.push(root);
    const ids = ['doc-01ARZ3NDEKTSV4RRFFQ69G5FAA', 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAB'];
    const store = await DesignDocumentStore.fromConfig(
      designDocsConfigSchema.parse({ enabled: true, cache: { stale_policy: 'rebuild' } }),
      root,
      { generateId: () => ids.shift() as string },
    );
    const first = await store.create({ title: 'Alpha', kind: 'hld', body: 'shared search phrase' });
    const second = await store.create({ title: 'Bravo', kind: 'lld', body: 'shared search phrase' });
    expect((await store.search({ query: 'shared' })).map((hit) => hit.id)).toEqual([first.id, second.id]);
    expect(await store.search({ query: 'shared', kind: 'lld' })).toMatchObject([{ id: second.id }]);
    expect(await store.search({ query: 'shared', id: first.id, location: 'active' })).toMatchObject([
      { id: first.id, location: 'active' },
    ]);
  });

  it('verifies several large canonical rows without materializing one oversized page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-cache-large-'));
    roots.push(root);
    const ids = [
      'doc-01ARZ3NDEKTSV4RRFFQ69G5FAA',
      'doc-01ARZ3NDEKTSV4RRFFQ69G5FAB',
      'doc-01ARZ3NDEKTSV4RRFFQ69G5FAC',
      'doc-01ARZ3NDEKTSV4RRFFQ69G5FAD',
      'doc-01ARZ3NDEKTSV4RRFFQ69G5FAE',
    ];
    const store = await DesignDocumentStore.fromConfig(
      designDocsConfigSchema.parse({ enabled: true, cache: { stale_policy: 'rebuild' } }),
      root,
      { generateId: () => ids.shift() as string },
    );
    const body = `large-token ${'x'.repeat(900_000)}`;
    for (let index = 0; index < 5; index++) await store.create({ title: `Large document ${index}`, kind: 'hld', body });

    expect(await store.search({ query: 'large' })).toHaveLength(5);
    // The second query exercises health checking against the ready cache.
    expect(await store.search({ query: 'large' })).toHaveLength(5);
  }, 30_000);

  it('preserves repository-store resource errors instead of reporting FTS syntax', async () => {
    const { store } = await fixture({ security: { limits: { max_result_bytes: 32 } } }, false);
    await expect(store.search({ query: 'SQLite' })).rejects.not.toMatchObject({ code: 'SEARCH_QUERY_INVALID' });
  });
});
