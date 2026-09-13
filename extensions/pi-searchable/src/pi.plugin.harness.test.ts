import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertHarnessConclusive,
  createTempProject,
  openrouterApiKey,
  piBin,
  piReady,
  repoRoot,
  requireSearchableDistBuilt,
  runPiWithModelFallback,
  type TempProject,
} from '@neottia/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Opt-in acceptance test for the real Pi extension and its canonical store. */
const apiKey = openrouterApiKey();
const bin = piBin();
const enabled = process.env.NEOTTIA_TEST_HARNESS === '1' && piReady(bin);
let project: TempProject;

beforeAll(() => {
  if (!enabled) return;
  requireSearchableDistBuilt(repoRoot());
  project = createTempProject();
  writeFileSync(
    project.configPath,
    `${readFileSync(project.configPath, 'utf8')}  searchable:\n    enabled: true\n    cache:\n      stale_policy: rebuild\n`,
  );
  const extensionPath = join(project.cwd, '.pi', 'extensions', 'neottia-searchable.ts');
  mkdirSync(join(extensionPath, '..'), { recursive: true });
  writeFileSync(
    extensionPath,
    `export { default } from ${JSON.stringify(join(repoRoot(), 'extensions', 'pi-searchable', 'src', 'index.ts'))};\n`,
  );
});

afterAll(() => project?.cleanup());

describe.skipIf(!enabled)('pi uses the Searchable extension in process', () => {
  it('stashes a page through a natural-language prompt', async () => {
    const run = runPiWithModelFallback({
      cwd: project.cwd,
      prompt:
        'Call web_stash with URL https://example.com/pi-searchable, title "Pi Searchable", and content "PI SEARCHABLE HARNESS MARKER". Then confirm in one short sentence.',
      piPath: bin as string,
      apiKey,
      xdgDataDir: project.xdgDataDir,
      xdgConfigDir: project.xdgConfigDir,
      homeDir: project.cwd,
    }).result;
    assertHarnessConclusive(run);
    const pages = join(project.cwd, '.neottia', 'searchable', 'pages');
    const content = readdirSync(pages)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readFileSync(join(pages, name), 'utf8'))
      .join('\n');
    expect(content).toContain('PI SEARCHABLE HARNESS MARKER');
  }, 300_000);
});
