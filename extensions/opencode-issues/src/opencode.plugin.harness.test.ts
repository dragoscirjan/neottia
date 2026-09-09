import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertHarnessSuccess,
  createTempIssueProject,
  ensureIssuesDistBuilt,
  isTransientModelError,
  openrouterApiKey,
  opencodeReady,
  repoRoot,
  runOpencodeWithModelFallback,
  type TempIssueProject,
} from '@neottia/testkit';
import { beforeAll, describe, expect, it } from 'vitest';

const apiKey = openrouterApiKey();
const enabled = process.env.NEOTTIA_TEST_HARNESS === '1' && opencodeReady();
let project: TempIssueProject;

beforeAll(() => {
  if (!enabled) return;
  ensureIssuesDistBuilt(repoRoot());
  project = createTempIssueProject();
  const pluginPath = join(project.cwd, '.opencode/plugins/neottia-issues.ts');
  mkdirSync(join(pluginPath, '..'), { recursive: true });
  writeFileSync(
    pluginPath,
    `export { default } from ${JSON.stringify(join(repoRoot(), 'extensions/opencode-issues/src/index.ts'))};\n`,
  );
});

describe.skipIf(!enabled)('OpenCode uses Issues in process', () => {
  it('creates a canonical issue in the active temporary project', async (context) => {
    const run = runOpencodeWithModelFallback({
      cwd: project.cwd,
      xdgDataDir: project.xdgDataDir,
      prompt: 'You MUST call issue_create to create a bug titled OpenCode Routing with body "Temporary project only".',
      apiKey,
    }).result;
    if (isTransientModelError(run)) return context.skip();
    assertHarnessSuccess(run);
    const files = readdirSync(project.issuesRoot).filter((name) => name.endsWith('.yml'));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(project.issuesRoot, files[0] as string), 'utf8')).toContain('OpenCode Routing');
  }, 300_000);
});
