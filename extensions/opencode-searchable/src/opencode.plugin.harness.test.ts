import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertHarnessConclusive,
  createTempProject,
  opencodeReady,
  requireSearchableDistBuilt,
  openrouterApiKey,
  repoRoot,
  runOpencodeWithModelFallback,
  type TempProject,
} from '@neottia/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Opt-in acceptance test for the real OpenCode plugin and canonical store. */
const apiKey = openrouterApiKey();
const enabled = process.env.NEOTTIA_TEST_HARNESS === '1' && opencodeReady();
let project: TempProject;

beforeAll(() => {
  if (!enabled) return;
  requireSearchableDistBuilt(repoRoot());
  project = createTempProject();
  writeFileSync(
    project.configPath,
    `${readFileSync(project.configPath, 'utf8')}  searchable:\n    enabled: true\n    cache:\n      stale_policy: rebuild\n`,
  );
  const pluginPath = join(project.cwd, '.opencode', 'plugins', 'neottia-searchable.ts');
  mkdirSync(join(pluginPath, '..'), { recursive: true });
  writeFileSync(
    pluginPath,
    `export { default } from ${JSON.stringify(join(repoRoot(), 'extensions', 'opencode-searchable', 'src', 'index.ts'))};\n`,
  );
});

afterAll(() => project?.cleanup());

describe.skipIf(!enabled)('OpenCode uses the Searchable plugin in process', () => {
  it('stashes a page through a natural-language prompt', async () => {
    const run = runOpencodeWithModelFallback({
      cwd: project.cwd,
      xdgDataDir: project.xdgDataDir,
      xdgConfigDir: project.xdgConfigDir,
      homeDir: project.cwd,
      prompt:
        'Call web_stash with URL https://example.com/opencode-searchable, title "OpenCode Searchable", and content "OPENCODE SEARCHABLE HARNESS MARKER". Then confirm in one short sentence.',
      apiKey,
    }).result;
    assertHarnessConclusive(run);
    const pages = join(project.cwd, '.neottia', 'searchable', 'pages');
    const content = readdirSync(pages)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readFileSync(join(pages, name), 'utf8'))
      .join('\n');
    expect(content).toContain('OPENCODE SEARCHABLE HARNESS MARKER');
  }, 300_000);
});
