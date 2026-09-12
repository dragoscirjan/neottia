import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DesignDocumentStore, loadDesignDocsConfig } from '@neottia/design-docs';
import { loadIssueConfig } from '@neottia/issues';
import { MemoryStore, loadMemoryConfig, memoryConfigContribution } from '@neottia/memory-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertHarnessConclusive,
  createConfigFixture,
  createTempIssueProject,
  createTempProject,
  ensureMemoryDistBuilt,
  mcpServersDocument,
  piBin,
  repoRoot,
  resolveFreeOpenRouterModel,
  runOpencode,
  runPi,
  seedDesignDocs,
  seedIssues,
  seedMemory,
  writeOpencodeMcpConfig,
  writeMcpServersJsonFile,
  writeServersMcpConfig,
  type TempProject,
} from './index.js';

const projects: TempProject[] = [];

afterEach(() => {
  while (projects.length) projects.pop()?.cleanup();
});

function fact(summary: string) {
  return {
    memory_type: 'semantic' as const,
    record_type: 'fact' as const,
    summary,
    source: { kind: 'user-confirmed' as const, ref: null, revision: null },
    created_by: 'testkit',
    confidence: 'confirmed' as const,
  };
}

describe('shared configuration fixtures', () => {
  it('covers every precedence layer and isolates multiple invocation directories', () => {
    const fixture = createConfigFixture({
      global: { memory: { enabled: true, namespace: { organization_id: 'global' } } },
      project: { memory: { retrieval: { limit: 3 } } },
      secondProject: { memory: { root: '.neottia/second-memory' } },
      profile: { name: 'ci', modules: { memory: { retrieval: { include_superseded: true } } } },
      env: { NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID: 'environment' },
      overrides: { modules: { memory: { cache: { stale_policy: 'fail' } } } },
    });
    try {
      const first = fixture.resolve().get(memoryConfigContribution);
      const second = fixture.resolve(fixture.cwds[1]).get(memoryConfigContribution);
      expect(first).toMatchObject({
        enabled: true,
        namespace: { organization_id: 'global', project_id: 'environment' },
        retrieval: { limit: 3, include_superseded: true },
        cache: { stale_policy: 'fail' },
      });
      expect(second.root).toBe('.neottia/second-memory');
      expect(first.root).toBe('.neottia/memory');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('temp project fixtures', () => {
  it('creates an enabled memory shard inside a temp folder only', () => {
    const project = createTempProject();
    projects.push(project);
    expect(project.cwd).toContain('neottia-harness-');
    expect(existsSync(project.configPath)).toBe(true);

    const config = loadMemoryConfig(project.cwd, { env: {} });
    expect(config.enabled).toBe(true);
    expect(config.root).toBe('.neottia/memory');
  });

  it('exports a usable Issues temp-project fixture', async () => {
    const project = createTempIssueProject();
    try {
      expect(loadIssueConfig(project.cwd, { env: {} }).enabled).toBe(true);
      await seedIssues(project, [{ type: 'task', title: 'Seeded issue' }]);
      expect(existsSync(project.issuesRoot)).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('applies config overrides to the generated shard', () => {
    const project = createTempProject({ memory: { namespace: { project_id: 'fixture' } } });
    projects.push(project);
    expect(loadMemoryConfig(project.cwd, { env: {} }).namespace.project_id).toBe('fixture');
  });

  it('seeds canonical design documents through the library', async () => {
    const project = createTempProject();
    projects.push(project);
    const [seeded] = await seedDesignDocs(project, [
      { title: 'Fixture Design', kind: 'hld', body: 'Temporary canonical document.' },
    ]);
    const store = await DesignDocumentStore.fromConfig(loadDesignDocsConfig(project.cwd, { env: {} }), project.cwd);
    expect((await store.get(seeded!.id)).title).toBe('Fixture Design');
    expect(existsSync(project.designDocsRoot)).toBe(true);
  });

  it('seeds canonical records deterministically through the library', async () => {
    const project = createTempProject();
    projects.push(project);
    await seedMemory(project, [fact('The integration codename is LLAMA')]);

    const store = MemoryStore.fromConfig(loadMemoryConfig(project.cwd, { env: {} }), project.cwd);
    const hits = await store.list();
    expect(hits).toHaveLength(1);
    expect(hits[0]?.summary).toContain('LLAMA');
    expect(existsSync(join(project.memoryRoot, 'index.db'))).toBe(true);
  });
});

describe('mcp config writers', () => {
  const server = { command: '/usr/bin/node', args: ['/tmp/server.js'], env: { NEOTTIA_MEMORY_ENABLED: 'true' } };

  it('writes the generic mcpServers shape (Claude Code, Kiro)', () => {
    const project = createTempProject();
    projects.push(project);
    const path = writeMcpServersJsonFile(join(project.cwd, 'mcp.json'), server);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcpServers.memory).toEqual({
      command: '/usr/bin/node',
      args: ['/tmp/server.js'],
      env: { NEOTTIA_MEMORY_ENABLED: 'true' },
    });
    expect(mcpServersDocument({ memory: server })).toMatchObject({ mcpServers: {} });
  });

  it('writes the VS Code servers shape', () => {
    const project = createTempProject();
    projects.push(project);
    const path = writeServersMcpConfig(join(project.cwd, '.vscode', 'mcp.json'), server);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.servers.memory.command).toBe('/usr/bin/node');
  });

  it('writes the OpenCode local-server shape', () => {
    const project = createTempProject();
    projects.push(project);
    const path = writeOpencodeMcpConfig(project.cwd, server);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcp.memory).toMatchObject({
      type: 'local',
      command: ['/usr/bin/node', '/tmp/server.js'],
      environment: { NEOTTIA_MEMORY_ENABLED: 'true' },
      enabled: true,
    });
    expect(parsed.$schema).toBe('https://opencode.ai/config.json');
  });
});

/** Restores one process environment entry after a runner contract case. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('deterministic harness runner contract', () => {
  it('honors binary and isolation overrides without a model provider', () => {
    const project = createTempProject();
    projects.push(project);
    const executable = join(project.cwd, 'capture-harness.mjs');
    const capture = join(project.cwd, 'capture.json');
    writeFileSync(
      executable,
      `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.NEOTTIA_HARNESS_CAPTURE, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), env: { HOME: process.env.HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME } }));\n`,
      'utf8',
    );
    chmodSync(executable, 0o755);
    const previousOpencodeBin = process.env.NEOTTIA_TEST_OPENCODE_BIN;
    const previousPiBin = process.env.NEOTTIA_TEST_PI_BIN;
    const previousCapture = process.env.NEOTTIA_HARNESS_CAPTURE;
    process.env.NEOTTIA_TEST_OPENCODE_BIN = executable;
    process.env.NEOTTIA_TEST_PI_BIN = executable;
    process.env.NEOTTIA_HARNESS_CAPTURE = capture;

    try {
      expect(piBin()).toBe(executable);
      const pi = runPi({
        cwd: project.cwd,
        prompt: 'deterministic pi contract',
        piPath: piBin() as string,
        modelId: 'contract/model',
        apiKey: 'test-key',
        xdgDataDir: project.xdgDataDir,
        xdgConfigDir: project.xdgConfigDir,
        homeDir: project.cwd,
      });
      assertHarnessConclusive(pi);
      expect(JSON.parse(readFileSync(capture, 'utf8'))).toMatchObject({
        args: [
          '-p',
          '--no-session',
          '--mode',
          'text',
          '-a',
          '--provider',
          'openrouter',
          '--model',
          'contract/model',
          'deterministic pi contract',
        ],
        cwd: project.cwd,
        env: {
          HOME: project.cwd,
          XDG_DATA_HOME: project.xdgDataDir,
          XDG_CONFIG_HOME: project.xdgConfigDir,
        },
      });

      const opencode = runOpencode({
        cwd: project.cwd,
        prompt: 'deterministic opencode contract',
        modelId: 'contract/model',
        apiKey: 'test-key',
        xdgDataDir: project.xdgDataDir,
        xdgConfigDir: project.xdgConfigDir,
        homeDir: project.cwd,
      });
      assertHarnessConclusive(opencode);
      expect(JSON.parse(readFileSync(capture, 'utf8'))).toMatchObject({
        args: ['run', '--model', 'openrouter/contract/model', 'deterministic opencode contract'],
        cwd: project.cwd,
        env: {
          HOME: project.cwd,
          XDG_DATA_HOME: project.xdgDataDir,
          XDG_CONFIG_HOME: project.xdgConfigDir,
        },
      });
    } finally {
      restoreEnv('NEOTTIA_TEST_OPENCODE_BIN', previousOpencodeBin);
      restoreEnv('NEOTTIA_TEST_PI_BIN', previousPiBin);
      restoreEnv('NEOTTIA_HARNESS_CAPTURE', previousCapture);
    }
  });

  it('reports exhausted transient providers as inconclusive', () => {
    expect(() =>
      assertHarnessConclusive({ stdout: '', stderr: '429 upstream temporarily overloaded', status: 1 }),
    ).toThrow(/acceptance was inconclusive/u);
  });
});

describe('dist and gating helpers', () => {
  it('builds the memory dist output on demand and returns the MCP entry', () => {
    const entry = ensureMemoryDistBuilt();
    expect(entry).toBe(join(repoRoot(), 'packages', 'memory-mcp', 'dist', 'cli.js'));
    expect(existsSync(entry)).toBe(true);
  }, 120_000);

  it('selects a free-tier OpenRouter model from a supplied catalog', () => {
    expect(resolveFreeOpenRouterModel([{ id: 'example/model:free' }])).toBe('example/model:free');
  });
});
