import { MemoryStore, loadMemoryConfig } from './index.js';

const [mode, cwd, id] = process.argv.slice(2);
if (mode === undefined || cwd === undefined) throw new Error('mode and cwd are required');
const store = MemoryStore.fromConfig(loadMemoryConfig(cwd, { env: {} }), cwd);
if (mode === 'seed') {
  const record = await store.store({
    memory_type: 'semantic',
    record_type: 'fact',
    summary: 'Cross runtime canonical projection',
    source: { kind: 'user-confirmed', ref: null, revision: null },
    created_by: 'cross-runtime-test',
    confidence: 'confirmed',
  });
  await store.search({ query: 'canonical projection' });
  process.stdout.write(record.id);
} else {
  if (id === undefined) throw new Error('verify requires an id');
  const validation = await store.validate();
  const results = await store.search({ query: 'canonical projection' });
  if (!validation.valid || results[0]?.id !== id) throw new Error('cross-runtime verification failed');
}
