import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STORE_LIMITS, resolveManagedRoot, withRepositoryLease } from './index.js';

const [authority, workerId, iterationInput = '1'] = process.argv.slice(2);
if (authority === undefined || workerId === undefined) throw new Error('Worker requires authority and ID arguments.');
const iterations = Number.parseInt(iterationInput, 10);
if (!Number.isSafeInteger(iterations) || iterations < 1) throw new Error('Worker iterations must be positive.');

const root = await resolveManagedRoot({
  authorityRoot: authority,
  managedPath: '.neottia/worker-fixture',
  limits: DEFAULT_STORE_LIMITS,
});
for (let iteration = 0; iteration < iterations; iteration++) {
  await withRepositoryLease(root, async () => {
    const trace = join(authority, 'lease-trace.txt');
    const acquisitionId = `${workerId}-${iteration}`;
    appendFileSync(trace, `${acquisitionId}:start\n`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3));
    appendFileSync(trace, `${acquisitionId}:end\n`);
  });
}
