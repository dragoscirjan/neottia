import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designDocsConfigSchema } from '../src/config.js';
import { DesignDocumentStore } from '../src/store.js';

/** Disposable Bun/SQLite FTS5 smoke test; canonical state never touches the workspace. */
const root = await mkdtemp(join(tmpdir(), 'neottia-design-bun-'));
try {
  const store = await DesignDocumentStore.fromConfig(
    designDocsConfigSchema.parse({ enabled: true, cache: { stale_policy: 'rebuild' } }),
    root,
    { generateId: () => 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV' },
  );
  await store.create({ title: 'Bun FTS5', kind: 'lld', body: 'Cross-runtime SQLite search.' });
  const hits = await store.search({ query: 'SQLite' });
  if (hits.length !== 1 || hits[0]?.title !== 'Bun FTS5') throw new Error('Bun Design Docs FTS5 conformance failed.');
  console.log('Bun Design Docs FTS5 conformance passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
