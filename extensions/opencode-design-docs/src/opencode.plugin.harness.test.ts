import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertHarnessSuccess,
  createTempProject,
  ensureDesignDocsDistBuilt,
  isTransientModelError,
  openrouterApiKey,
  opencodeReady,
  repoRoot,
  runOpencodeWithModelFallback,
  type TempProject,
} from '@neottia/testkit';
import { beforeAll, describe, expect, it } from 'vitest';

const apiKey = openrouterApiKey();
const enabled = process.env.NEOTTIA_TEST_HARNESS === '1' && opencodeReady();
let project: TempProject;
beforeAll(() => {
  if (!enabled) return;
  ensureDesignDocsDistBuilt(repoRoot());
  project = createTempProject();
  const pluginPath = join(project.cwd, '.opencode/plugins/neottia-design-docs.ts');
  mkdirSync(join(pluginPath, '..'), { recursive: true });
  writeFileSync(
    pluginPath,
    `export { default } from ${JSON.stringify(join(repoRoot(), 'extensions/opencode-design-docs/src/index.ts'))};\n`,
  );
});

describe.skipIf(!enabled)('OpenCode uses Design Docs in process', () => {
  it('creates a canonical draft in the active temporary project', async (context) => {
    const run = runOpencodeWithModelFallback({
      cwd: project.cwd,
      xdgDataDir: project.xdgDataDir,
      prompt:
        'You MUST call document_create to create an lld titled OpenCode Routing with body "Temporary project only".',
      apiKey,
    }).result;
    if (isTransientModelError(run)) return context.skip();
    assertHarnessSuccess(run);
    const files = readdirSync(project.designDocsRoot).filter((name) => name.endsWith('.md'));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(project.designDocsRoot, files[0] as string), 'utf8')).toContain('OpenCode Routing');
  }, 300_000);
});
