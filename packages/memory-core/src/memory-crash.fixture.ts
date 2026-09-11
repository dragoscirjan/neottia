import { MemoryStore, loadMemoryConfig } from './index.js';
import { setTransactionFaultInjectorForTests } from '../../repository-store/dist/internal/fault-injection.js';

const [cwd, requestedEvent] = process.argv.slice(2);
if (cwd === undefined || requestedEvent === undefined) throw new Error('cwd and event are required');
const store = MemoryStore.fromConfig(loadMemoryConfig(cwd, { env: {} }), cwd);
setTransactionFaultInjectorForTests((event) => {
  if (event === requestedEvent) process.kill(process.pid, 'SIGKILL');
});
await store.store({
  memory_type: 'semantic',
  record_type: 'fact',
  summary: `Crash recovery at ${requestedEvent}`,
  source: { kind: 'user-confirmed', ref: null, revision: null },
  created_by: 'crash-test',
  confidence: 'confirmed',
});
