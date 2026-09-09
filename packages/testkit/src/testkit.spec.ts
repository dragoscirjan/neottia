import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadIssueConfig } from '@neottia/issues';
import { MemoryStore, loadMemoryConfig } from '@neottia/memory-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTempIssueProject,
  createTempProject,
  ensureMemoryDistBuilt,
  mcpServersDocument,
  openrouterModelId,
  repoRoot,
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

describe('dist and gating helpers', () => {
  it('builds the memory dist output on demand and returns the MCP entry', () => {
    const entry = ensureMemoryDistBuilt();
    expect(entry).toBe(join(repoRoot(), 'packages', 'memory-mcp', 'dist', 'cli.js'));
    expect(existsSync(entry)).toBe(true);
  }, 120_000);

  it('defaults to a free-tier OpenRouter model', () => {
    expect(openrouterModelId()).toMatch(/:free$/u);
  });
});
