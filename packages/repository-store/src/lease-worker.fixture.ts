import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STORE_LIMITS, resolveManagedRoot, withRepositoryLease } from './index.js';
import { setFilesystemFaultInjectorForTests } from './internal/fault-injection.js';

const [authority, workerId, iterationInput = '1', raceDirective] = process.argv.slice(2);
if (authority === undefined || workerId === undefined) throw new Error('Worker requires authority and ID arguments.');
const iterations = Number.parseInt(iterationInput, 10);
if (!Number.isSafeInteger(iterations) || iterations < 1) throw new Error('Worker iterations must be positive.');

const root = await resolveManagedRoot({
  authorityRoot: authority,
  managedPath: '.neottia/worker-fixture',
  limits: DEFAULT_STORE_LIMITS,
});

if (raceDirective !== undefined) {
  if (raceDirective !== 'released' && raceDirective !== 'substituted')
    throw new Error(`Unknown claim race directive: ${raceDirective}`);
  replayClaimReadRace(authority, workerId, raceDirective);
}

for (let iteration = 0; iteration < iterations; iteration++) {
  await withRepositoryLease(root, async () => {
    const trace = join(authority, 'lease-trace.txt');
    const acquisitionId = `${workerId}-${iteration}`;
    appendFileSync(trace, `${acquisitionId}:start\n`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3));
    appendFileSync(trace, `${acquisitionId}:end\n`);
  });
}

/**
 * Deterministic replay of the multiprocess claim-read race behind issue #123.
 * Freezes this contender's bounded authority.claim read after the descriptor
 * opens, lets the coordinator mutate the claim artifact (release or substitute
 * it), and then resumes so the descriptor observes the mutated link state.
 */
function replayClaimReadRace(authority: string, workerId: string, directive: string): void {
  const claimPath = join(authority, '.neottia', 'repository-store', 'authority.claim');
  const openedMarker = join(authority, `race-opened-${workerId}`);
  const resumeMarker = join(authority, `race-resume-${workerId}`);
  let armed = true;
  setFilesystemFaultInjectorForTests((event, target) => {
    // One shot: only the contender's first reclaim read must freeze; later
    // reads (for example removeOwnedClaim ownership verification) continue.
    if (!armed || event !== 'bounded-read-opened' || target !== claimPath) return;
    armed = false;
    appendFileSync(openedMarker, `${directive}\n`);
    // Synchronous spin: the filesystem state must stay frozen while the
    // coordinator mutates the claim behind the already-open descriptor.
    for (let attempt = 0; !existsSync(resumeMarker); attempt += 1) {
      if (attempt > 3_000_000) throw new Error('Claim race coordinator never resumed the worker.');
    }
  });
}
