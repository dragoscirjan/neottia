import {
  assertHarnessSuccess,
  createTempProject,
  openrouterApiKey,
  piBin,
  piReady,
  repoRoot,
  isTransientModelError,
  runPiWithModelFallback,
  seedMemory,
  type TempProject,
} from '@neottia/testkit';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration test: the real pi CLI loads the real extension (project-local
 * `.pi/extensions/`) and uses the in-process memory tools — no MCP involved.
 * Opt-in via NEOTTIA_TEST_HARNESS=1; requires a pi binary and OpenRouter auth.
 */

const apiKey = openrouterApiKey();
const bin = piBin();
const enabled = process.env.NEOTTIA_TEST_HARNESS === '1' && piReady(bin);

let project: TempProject;

beforeAll(() => {
  if (!enabled) return;
  // The extension entrypoint re-exports the in-repo extension source; jiti
  // resolves its imports from the real file's location.
  const extensionSource = join(repoRoot(), 'extensions', 'pi-memory', 'src', 'index.ts');
  project = createTempProject();
  const extensionPath = join(project.cwd, '.pi', 'extensions', 'neottia-memory.ts');
  mkdirSync(join(extensionPath, '..'), { recursive: true });
  writeFileSync(extensionPath, `export { default } from ${JSON.stringify(extensionSource)};\n`, 'utf8');
}, 180_000);

describe.skipIf(!enabled)('pi uses the memory extension in-process', () => {
  it('stores a memory through a natural-language prompt', async (ctx) => {
    const fallback = runPiWithModelFallback({
      cwd: project.cwd,
      prompt:
        'Use the memory_store tool to remember the following fact, then confirm in one short sentence: the release codename is SCROLL.',
      piPath: bin as string,
      apiKey: apiKey,
    });
    const run = fallback.result;
    // Free-pool congestion is transient: skip instead of failing the suite.
    if (isTransientModelError(run)) return ctx.skip();
    assertHarnessSuccess(run);

    const factsDir = join(project.memoryRoot, 'facts');
    const files = readdirSync(factsDir).filter((name) => name.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(0);
    const contents = files.map((name) => readFileSync(join(factsDir, name), 'utf8')).join('\n');
    expect(contents).toMatch(/SCROLL/u);
  }, 300_000);

  it('recalls a seeded memory via memory_search', async (ctx) => {
    seedMemory(project, [
      {
        memory_type: 'semantic',
        record_type: 'fact',
        summary: 'The deployment codename is OBELISK',
        source: { kind: 'user-confirmed', ref: null, revision: null },
        created_by: 'testkit',
        confidence: 'confirmed',
      },
    ]);

    const fallback = runPiWithModelFallback({
      cwd: project.cwd,
      prompt: 'Use the memory_search tool to look up the deployment codename, then answer with only the codename.',
      piPath: bin as string,
      apiKey: apiKey,
    });
    const run = fallback.result;
    // Free-pool congestion is transient: skip instead of failing the suite.
    if (isTransientModelError(run)) return ctx.skip();
    assertHarnessSuccess(run);
    expect(run.stdout).toMatch(/OBELISK/u);
  }, 300_000);
});
