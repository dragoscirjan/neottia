import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DesignDocumentStore,
  loadDesignDocsConfig,
  type CreateDocumentInput,
  type DesignDocsConfigInput,
  type DocumentRecord,
} from '@neottia/design-docs';
import { IssueStore, loadIssueConfig, type CreateIssueInput, type IssueConfigInput } from '@neottia/issues';
import { loadMemoryConfig, MemoryStore, type MemoryConfigInput, type StoreMemoryInput } from '@neottia/memory-core';

/**
 * Temp-project fixtures: every harness integration test runs inside a
 * disposable directory. The repository and real workspace folders stay
 * immutable while tests execute (AGENTS.md testing rule).
 */

export interface TempProject {
  /** Working directory of the fake project (what the harness is launched with). */
  readonly cwd: string;
  /** Absolute memory root inside the project. */
  readonly memoryRoot: string;
  /** Canonical Design Docs root inside the project. */
  readonly designDocsRoot: string;
  /** Path of the generated `.neottia/config.yml`. */
  readonly configPath: string;
  /** Isolated XDG data dir: harness state (auth.json, logs) stays inside the temp tree. */
  readonly xdgDataDir: string;
  /** Isolated XDG config dir: global harness configs (plugins, MCP servers) cannot leak in. */
  readonly xdgConfigDir: string;
  /** Removes the whole directory tree. */
  cleanup: () => void;
}

export interface CreateTempProjectOptions {
  /** Extra values merged into the `skills.memory` config shard. */
  memory?: Partial<MemoryConfigInput>;
  /** Extra values merged into the `skills.design_docs` config shard. */
  designDocs?: Partial<DesignDocsConfigInput>;
}

/** Disposable project specialized for Issues integration tests. */
export interface TempIssueProject {
  readonly cwd: string;
  readonly issuesRoot: string;
  readonly configPath: string;
  readonly xdgDataDir: string;
  readonly xdgConfigDir: string;
  cleanup(): void;
}

export interface CreateTempIssueProjectOptions {
  /** Extra values merged into the enabled `skills.issues` shard. */
  readonly issues?: Partial<IssueConfigInput>;
}

/**
 * Creates a fake project with an enabled memory shard.
 * Shape: <tmp>/<project>/.neottia/config.yml (+ memory root created lazily).
 */
export function createTempProject(options: CreateTempProjectOptions = {}): TempProject {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-harness-'));
  const configPath = join(cwd, '.neottia', 'config.yml');
  mkdirSync(join(configPath, '..'), { recursive: true });

  const memoryShard = { enabled: true, ...(options.memory ?? {}) };
  const designDocsShard = { enabled: true, ...(options.designDocs ?? {}) };
  writeFileSync(
    configPath,
    `version: 1\nskills:\n  memory:\n${yamlShard(memoryShard)}  design_docs:\n${yamlShard(designDocsShard)}`,
    'utf8',
  );

  const xdgDataDir = join(cwd, '.xdg-data');
  mkdirSync(xdgDataDir, { recursive: true });
  // A minimal global config: without this, the user's global plugins and MCP
  // servers (which may expose colliding tool names) leak into the test.
  const xdgConfigDir = join(cwd, '.xdg-config');
  const harnessConfigDir = join(xdgConfigDir, 'opencode');
  mkdirSync(harnessConfigDir, { recursive: true });
  writeFileSync(join(harnessConfigDir, 'opencode.json'), '{}\n', 'utf8');
  return {
    cwd,
    memoryRoot: join(cwd, '.neottia', 'memory'),
    designDocsRoot: join(cwd, '.neottia', 'design-docs'),
    configPath,
    xdgDataDir,
    xdgConfigDir,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

/** Creates an isolated project with only the strict Issues shard enabled. */
export function createTempIssueProject(options: CreateTempIssueProjectOptions = {}): TempIssueProject {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-issues-harness-'));
  const configPath = join(cwd, '.neottia', 'config.yml');
  mkdirSync(join(configPath, '..'), { recursive: true });
  writeFileSync(
    configPath,
    `version: 1\nskills:\n  issues:\n${yamlShard({ enabled: true, ...(options.issues ?? {}) })}`,
    'utf8',
  );
  const xdgDataDir = join(cwd, '.xdg-data');
  const xdgConfigDir = join(cwd, '.xdg-config');
  mkdirSync(xdgDataDir, { recursive: true });
  mkdirSync(join(xdgConfigDir, 'opencode'), { recursive: true });
  writeFileSync(join(xdgConfigDir, 'opencode', 'opencode.json'), '{}\n', 'utf8');
  return {
    cwd,
    issuesRoot: join(cwd, '.neottia', 'issues'),
    configPath,
    xdgDataDir,
    xdgConfigDir,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

/** Seeds canonical issues through the library without relying on an LLM. */
export async function seedIssues(project: TempIssueProject, inputs: readonly CreateIssueInput[]): Promise<void> {
  const store = new IssueStore(loadIssueConfig(project.cwd, { env: {} }), project.cwd);
  for (const input of inputs) await store.create(input);
}

/**
 * Seeds canonical memory records directly through the library — deterministic
 * filesystem state that does not depend on an LLM behaving.
 */
export async function seedMemory(project: TempProject, inputs: StoreMemoryInput[]): Promise<void> {
  const config = loadMemoryConfig(project.cwd, { env: {} });
  const store = MemoryStore.fromConfig(config, project.cwd);
  for (const input of inputs) await store.store(input);
}

/** Seeds canonical design documents directly through the domain library. */
export async function seedDesignDocs(
  project: TempProject,
  inputs: readonly CreateDocumentInput[],
): Promise<DocumentRecord[]> {
  const store = await DesignDocumentStore.fromConfig(loadDesignDocsConfig(project.cwd, { env: {} }), project.cwd);
  const records: DocumentRecord[] = [];
  for (const input of inputs) records.push(await store.create(input));
  return records;
}

/** Renders a flat config shard as YAML with two-space indentation. */
function yamlShard(shard: Record<string, unknown>, indent = '    '): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(shard)) {
    if (value !== null && typeof value === 'object') {
      lines.push(`${indent}${key}:`);
      lines.push(yamlShard(value as Record<string, unknown>, `${indent}  `));
      continue;
    }
    lines.push(`${indent}${key}: ${JSON.stringify(value)}`);
  }
  return `${lines.join('\n')}\n`;
}
