import { DEFAULT_STORE_LIMITS, resolveManagedRoot, withRepositoryLease } from '../dist/index.js';
import { setLeaseFaultInjectorForTests } from '../dist/internal/fault-injection.js';

const [authority, requestedEvent] = process.argv.slice(2);
if (authority === undefined || requestedEvent === undefined)
  throw new Error('Lease crash worker requires authority and fault-event arguments.');

setLeaseFaultInjectorForTests((event) => {
  if (event === requestedEvent) process.kill(process.pid, 'SIGKILL');
});
const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
await withRepositoryLease(root, async () => undefined, { staleMs: 1 });
