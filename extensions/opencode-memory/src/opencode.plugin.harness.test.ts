import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertHarnessSuccess,
  createTempProject,
  ensureMemoryDistBuilt,
  openrouterApiKey,
  repoRoot,
  isTransientModelError,
  runOpencodeWithModelFallback,
  seedMemory,
  type TempProject,
} from '@neottia/testkit';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration test: the real OpenCode CLI loads the real plugin (project-local
 * `.opencode/plugins/`) and uses the in-process memory tools — no MCP server.
 * Opt-in via NEOTTIA_TEST_HARNESS=1; requires stored OpenCode OpenRouter auth
 * or OPENROUTER_API_KEY.
 */

function randomSuffix(): string {
  return Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 23)]).join('');
}

const apiKey = openrouterApiKey();
const enabled = process.env.NEOTTIA_TEST_HARNESS === '1' && (Boolean(apiKey) || existsSync(authJsonPath()));

function authJsonPath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? '~', '.local', 'share');
  return join(dataHome, 'opencode', 'auth.json');
}

let project: TempProject;

beforeAll(() => {
  if (!enabled) return;
  ensureMemoryDistBuilt(repoRoot());
  // The plugin file re-exports the in-repo plugin source; bun resolves its
  // imports from the real file's location.
  project = createTempProject();
  const pluginPath = join(project.cwd, '.opencode', 'plugins', 'neottia-memory.ts');
  mkdirSync(join(pluginPath, '..'), { recursive: true });
  writeFileSync(
    pluginPath,
    `export { default } from ${JSON.stringify(join(repoRoot(), 'extensions', 'opencode-memory', 'src', 'index.ts'))};\n`,
    'utf8',
  );
  // OpenCode needs the workspace dependency resolvable from the plugin's
  // import chain: the repo node_modules provides it through the re-export.
}, 180_000);

describe.skipIf(!enabled)('opencode uses the memory plugin in-process', () => {
  const runCodename = `PAPYRUS-${randomSuffix()}`;
  const seedCodename = `WATERFALL-${randomSuffix()}`;

  it('stores a memory through a natural-language prompt', async (ctx) => {
    const fallback = runOpencodeWithModelFallback({
      cwd: project.cwd,
      xdgDataDir: project.xdgDataDir,
      prompt: `You MUST call the memory_store tool now to remember the following fact, then confirm in one short sentence: the release codename is ${runCodename}.`,
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
    expect(contents).toContain(runCodename);
  }, 300_000);

  it('recalls a seeded memory via memory_search', async (ctx) => {
    seedMemory(project, [
      {
        memory_type: 'semantic',
        record_type: 'fact',
        summary: `The deployment codename is ${seedCodename}`,
        source: { kind: 'user-confirmed', ref: null, revision: null },
        created_by: 'testkit',
        confidence: 'confirmed',
      },
    ]);

    const fallback = runOpencodeWithModelFallback({
      cwd: project.cwd,
      xdgDataDir: project.xdgDataDir,
      prompt: `You MUST call the memory_search tool with the query "deployment codename", then answer with only the codename from the results.`,
      apiKey: apiKey,
    });
    const run = fallback.result;
    // Free-pool congestion is transient: skip instead of failing the suite.
    if (isTransientModelError(run)) return ctx.skip();
    assertHarnessSuccess(run);
    expect(run.stdout).toContain(seedCodename);
  }, 300_000);
});
