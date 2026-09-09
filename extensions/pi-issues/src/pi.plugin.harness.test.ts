import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertHarnessSuccess,
  createTempIssueProject,
  ensureIssuesDistBuilt,
  isTransientModelError,
  openrouterApiKey,
  piBin,
  piReady,
  repoRoot,
  runPiWithModelFallback,
  type TempIssueProject,
} from '@neottia/testkit';
import { beforeAll, describe, expect, it } from 'vitest';

const apiKey = openrouterApiKey();
const bin = piBin();
const enabled = process.env.NEOTTIA_TEST_HARNESS === '1' && piReady(bin);
let project: TempIssueProject;

beforeAll(() => {
  if (!enabled) return;
  ensureIssuesDistBuilt(repoRoot());
  project = createTempIssueProject();
  const extensionPath = join(project.cwd, '.pi/extensions/neottia-issues.ts');
  mkdirSync(join(extensionPath, '..'), { recursive: true });
  writeFileSync(
    extensionPath,
    `export { default } from ${JSON.stringify(join(repoRoot(), 'extensions/pi-issues/src/index.ts'))};\n`,
  );
});

describe.skipIf(!enabled)('Pi uses Issues in process', () => {
  it('creates a canonical issue in the active temporary project', async (context) => {
    const run = runPiWithModelFallback({
      cwd: project.cwd,
      prompt: 'Use issue_create to create a task titled Harness Routing with body "Temporary project only".',
      piPath: bin as string,
      apiKey,
    }).result;
    if (isTransientModelError(run)) return context.skip();
    assertHarnessSuccess(run);
    const files = readdirSync(project.issuesRoot).filter((name) => name.endsWith('.yml'));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(project.issuesRoot, files[0] as string), 'utf8')).toContain('Harness Routing');
  }, 300_000);
});
