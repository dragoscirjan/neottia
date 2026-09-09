import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertHarnessSuccess,
  createTempProject,
  ensureDesignDocsDistBuilt,
  isTransientModelError,
  openrouterApiKey,
  piBin,
  piReady,
  repoRoot,
  runPiWithModelFallback,
  type TempProject,
} from '@neottia/testkit';
import { beforeAll, describe, expect, it } from 'vitest';

const apiKey = openrouterApiKey();
const bin = piBin();
const enabled = process.env.NEOTTIA_TEST_HARNESS === '1' && piReady(bin);
let project: TempProject;
beforeAll(() => {
  if (!enabled) return;
  ensureDesignDocsDistBuilt(repoRoot());
  project = createTempProject();
  const extensionPath = join(project.cwd, '.pi/extensions/neottia-design-docs.ts');
  mkdirSync(join(extensionPath, '..'), { recursive: true });
  writeFileSync(
    extensionPath,
    `export { default } from ${JSON.stringify(join(repoRoot(), 'extensions/pi-design-docs/src/index.ts'))};\n`,
  );
});

describe.skipIf(!enabled)('Pi uses Design Docs in process', () => {
  it('creates a canonical draft in the active temporary project', async (context) => {
    const run = runPiWithModelFallback({
      cwd: project.cwd,
      prompt: 'Use document_create to create an hld titled Harness Routing with body "Temporary project only".',
      piPath: bin as string,
      apiKey,
    }).result;
    if (isTransientModelError(run)) return context.skip();
    assertHarnessSuccess(run);
    const files = readdirSync(project.designDocsRoot).filter((name) => name.endsWith('.md'));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(project.designDocsRoot, files[0] as string), 'utf8')).toContain('Harness Routing');
  }, 300_000);
});
