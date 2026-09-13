import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  assertHarnessConclusive,
  createTempProject,
  ensureMemoryDistBuilt,
  ensureSearchableDistBuilt,
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
let packedSearchableRoot = '';
let packedSearchableEntry = '';

beforeAll(() => {
  if (!enabled) return;
  ensureMemoryDistBuilt(repoRoot());
  ensureSearchableDistBuilt(repoRoot());
  ({ root: packedSearchableRoot, entry: packedSearchableEntry } = installPackedSearchableMcp(repoRoot()));
}, 180_000);

afterAll(() => {
  if (packedSearchableRoot) rmSync(packedSearchableRoot, { recursive: true, force: true });
});

afterEach(() => project?.cleanup());

describe.skipIf(!enabled)('opencode drives the searchable MCP server', () => {
  it('stashes a page through the compiled MCP entry', async () => {
    project = createTempProject();
    writeOpencodeMcpConfig(project.cwd, {
      command: process.execPath,
      args: [packedSearchableEntry],
      env: {
        NEOTTIA_SEARCHABLE_ENABLED: 'true',
        NEOTTIA_SEARCHABLE_CACHE_STALE_POLICY: 'rebuild',
      },
    });

    const run = runOpencode({
      cwd: project.cwd,
      xdgDataDir: project.xdgDataDir,
      xdgConfigDir: project.xdgConfigDir,
      homeDir: project.cwd,
      prompt:
        'Call web_stash with URL https://example.com/searchable-harness, title "Harness Page", and content "PACKAGED SEARCHABLE MCP MARKER". Then confirm in one short sentence.',
    });
    assertHarnessConclusive(run);
    const pages = join(project.cwd, '.neottia', 'searchable', 'pages');
    const contents = readdirSync(pages)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readFileSync(join(pages, name), 'utf8'))
      .join('\n');
    expect(contents).toMatch(/PACKAGED SEARCHABLE MCP MARKER/u);
  }, 300_000);
});

/** Installs local package tarballs so OpenCode never loads workspace sources. */
function installPackedSearchableMcp(root: string): { readonly root: string; readonly entry: string } {
  const installation = mkdtempSync(join(tmpdir(), 'neottia-searchable-packed-'));
  const artifacts = join(installation, 'artifacts');
  const packages = ['repository-store', 'searchable-core', 'searchable-mcp'];
  const tarballs: Record<string, string> = {};
  for (const name of packages) {
    const output = execFileSync('pnpm', ['pack', '--pack-destination', artifacts], {
      cwd: join(root, 'packages', name),
      encoding: 'utf8',
    }).trim();
    tarballs[name] = resolve(artifacts, output.split('\n').at(-1) as string);
  }
  const extracted = join(installation, 'extracted');
  const repositoryStore = extract(tarballs['repository-store'] as string, join(extracted, 'repository-store'));
  const core = extract(tarballs['searchable-core'] as string, join(extracted, 'searchable-core'));
  const mcp = extract(tarballs['searchable-mcp'] as string, join(extracted, 'searchable-mcp'));
  linkDependency(mcp, '@neottia/searchable-core', core);
  linkDependency(core, '@neottia/repository-store', repositoryStore);
  for (const dependency of ['@mozilla/readability', 'jsdom', 'turndown', 'yaml', 'zod'])
    linkDependency(core, dependency, join(root, 'packages', 'searchable-core', 'node_modules', dependency));
  linkDependency(
    mcp,
    '@modelcontextprotocol/sdk',
    join(root, 'packages', 'searchable-mcp', 'node_modules', '@modelcontextprotocol', 'sdk'),
  );
  execFileSync('node', ['scripts/install-native.mjs'], {
    cwd: repositoryStore,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${join(root, 'packages', 'repository-store', 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    },
  });
  return { root: installation, entry: join(mcp, 'dist', 'cli.js') };
}

function extract(tarball: string, destination: string): string {
  mkdirSync(destination, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', destination]);
  return join(destination, 'package');
}

function linkDependency(parent: string, dependency: string, target: string): void {
  const destination = join(parent, 'node_modules', dependency);
  mkdirSync(join(destination, '..'), { recursive: true });
  symlinkSync(target, destination, 'dir');
}

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
      homeDir: project.cwd,
      prompt:
        'Call the tool named memory_store to remember the following fact, then confirm in one short sentence: the release codename is PAPYRUS.',
    });
    assertHarnessConclusive(run);

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
      homeDir: project.cwd,
      prompt:
        'Call the tool named memory_search (the Neottia memory MCP server) with the query "deployment codename", then answer with only the codename from the results.',
    });
    assertHarnessConclusive(run);
    expect(run.stdout).toMatch(/WATERFALL/u);
  }, 300_000);
});
