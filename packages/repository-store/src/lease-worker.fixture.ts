import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STORE_LIMITS, resolveManagedRoot, withRepositoryLease } from './index.js';

const [authority, workerId] = process.argv.slice(2);
if (authority === undefined || workerId === undefined) throw new Error('Worker requires authority and ID arguments.');

const root = await resolveManagedRoot({
  authorityRoot: authority,
  managedPath: '.neottia/worker-fixture',
  limits: DEFAULT_STORE_LIMITS,
});
await withRepositoryLease(root, async () => {
  const trace = join(authority, 'lease-trace.txt');
  appendFileSync(trace, `${workerId}:start\n`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
  appendFileSync(trace, `${workerId}:end\n`);
});
