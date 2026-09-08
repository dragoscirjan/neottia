import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  assertHarnessSuccess,
  createTempProject,
  ensureMemoryDistBuilt,
  memoryMcpEntry,
  opencodeReady,
  repoRoot,
  runOpencode,
  seedMemory,
  writeOpencodeMcpConfig,
  type TempProject,
} from './index.js';

/**
 * Integration test: the real OpenCode CLI drives the real memory MCP server
 * (spawned from the compiled dist) against a temp project, using a free
 * OpenRouter model. Skipped unless OPENROUTER_API_KEY is set and an opencode
 * binary is available (NEOTTIA_TEST_OPENCODE_BIN overrides the lookup).
 */

// Harness E2E runs are opt-in (mise run test:harness): they depend on live
// free-model availability and must never gate `mise run validate`.
const enabled = process.env.NEOTTIA_TEST_HARNESS === '1' && opencodeReady();

let project: TempProject;

beforeAll(() => {
  if (!enabled) return;
  ensureMemoryDistBuilt(repoRoot());
}, 180_000);

describe.skipIf(!enabled)('opencode drives the memory MCP server', () => {
  it('stores a memory through a natural-language prompt', async () => {
    project = createTempProject();
    writeOpencodeMcpConfig(project.cwd, {
      command: process.execPath,
      args: [memoryMcpEntry(repoRoot())],
      // Absolute root: harnesses may spawn MCP servers from a different cwd.
      env: {
        NEOTTIA_MEMORY_ENABLED: 'true',
        NEOTTIA_MEMORY_ROOT: project.memoryRoot,
        NEOTTIA_MEMORY_CACHE_STALE_POLICY: 'rebuild',
      },
    });

    const run = runOpencode({
      cwd: project.cwd,
      xdgDataDir: project.xdgDataDir,
      xdgConfigDir: project.xdgConfigDir,
      prompt:
        'Call the tool named memory_store to remember the following fact, then confirm in one short sentence: the release codename is PAPYRUS.',
    });
    assertHarnessSuccess(run);

    // Deterministic check: the YAML canonical store must contain the codename.
    const factsDir = join(project.memoryRoot, 'facts');
    const files = readdirSync(factsDir).filter((name) => name.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(0);
    const contents = files.map((name) => readFileSync(join(factsDir, name), 'utf8')).join('\n');
    expect(contents).toMatch(/PAPYRUS/u);
  }, 300_000);

  it('recalls a seeded memory via memory_search', async () => {
    project = createTempProject();
    writeOpencodeMcpConfig(project.cwd, {
      command: process.execPath,
      args: [memoryMcpEntry(repoRoot())],
      // Absolute root: harnesses may spawn MCP servers from a different cwd.
      env: {
        NEOTTIA_MEMORY_ENABLED: 'true',
        NEOTTIA_MEMORY_ROOT: project.memoryRoot,
        NEOTTIA_MEMORY_CACHE_STALE_POLICY: 'rebuild',
      },
    });
    await seedMemory(project, [
      {
        memory_type: 'semantic',
        record_type: 'fact',
        summary: 'The deployment codename is WATERFALL',
        source: { kind: 'user-confirmed', ref: null, revision: null },
        created_by: 'testkit',
        confidence: 'confirmed',
      },
    ]);

    const run = runOpencode({
      cwd: project.cwd,
      xdgDataDir: project.xdgDataDir,
      xdgConfigDir: project.xdgConfigDir,
      prompt:
        'Call the tool named memory_search (the Neottia memory MCP server) with the query "deployment codename", then answer with only the codename from the results.',
    });
    assertHarnessSuccess(run);
    expect(run.stdout).toMatch(/WATERFALL/u);
  }, 300_000);
});
