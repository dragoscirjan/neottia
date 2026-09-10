import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository layout helpers. The testkit lives at packages/testkit, so the
 * repository root is three levels up from this file's directory.
 */

const thisDir = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the repository (or branch worktree) containing the testkit. */
export function repoRoot(): string {
  return resolve(thisDir, '..', '..', '..');
}

/** Entry point a harness must spawn to run the Issues MCP server. */
export function issuesMcpEntry(root: string = repoRoot()): string {
  return join(root, 'packages', 'issues-mcp', 'dist', 'cli.js');
}

/** Builds Issues output required by external harness runtimes. */
export function ensureIssuesDistBuilt(root: string = repoRoot()): string {
  const entry = issuesMcpEntry(root);
  const coreDist = join(root, 'packages', 'issues', 'dist', 'index.js');
  const options = { cwd: root, stdio: 'inherit' } as const;
  if (!existsSync(coreDist)) execFileSync('pnpm', ['--filter', '@neottia/issues', 'run', 'build'], options);
  if (!existsSync(entry)) execFileSync('pnpm', ['--filter', '@neottia/issues-mcp', 'run', 'build'], options);
  if (!existsSync(entry)) throw new Error(`issues-mcp dist still missing after build: ${entry}`);
  return entry;
}

/** Entry point a harness must spawn to run the Design Docs MCP server. */
export function designDocsMcpEntry(root: string = repoRoot()): string {
  return join(root, 'packages', 'design-docs-mcp', 'dist', 'cli.js');
}

/** Builds Design Docs library/server output needed by external harness runtimes. */
export function ensureDesignDocsDistBuilt(root: string = repoRoot()): string {
  const entry = designDocsMcpEntry(root);
  const coreDist = join(root, 'packages', 'design-docs', 'dist', 'index.js');
  const options = { cwd: root, stdio: 'inherit' } as const;
  if (!existsSync(coreDist)) execFileSync('pnpm', ['--filter', '@neottia/design-docs', 'run', 'build'], options);
  if (!existsSync(entry)) execFileSync('pnpm', ['--filter', '@neottia/design-docs-mcp', 'run', 'build'], options);
  if (!existsSync(entry)) throw new Error(`design-docs-mcp dist still missing after build: ${entry}`);
  return entry;
}

/** Entry point a harness must spawn to run the memory MCP server. */
export function memoryMcpEntry(root: string = repoRoot()): string {
  return join(root, 'packages', 'memory-mcp', 'dist', 'cli.js');
}

/**
 * Builds the memory packages' dist output when missing. Harnesses spawn
 * `node packages/memory-mcp/dist/cli.js`, which imports the compiled
 * @neottia/memory-core dist, so both must exist before integration tests run.
 */
export function ensureMemoryDistBuilt(root: string = repoRoot()): string {
  const entry = memoryMcpEntry(root);
  const coreDist = join(root, 'packages', 'memory-core', 'dist', 'index.js');
  if (existsSync(entry) && existsSync(coreDist)) return entry;

  const options = { cwd: root, stdio: 'inherit' } as const;
  if (!existsSync(coreDist)) execFileSync('pnpm', ['--filter', '@neottia/memory-core', 'run', 'build'], options);
  if (!existsSync(entry)) execFileSync('pnpm', ['--filter', '@neottia/memory-mcp', 'run', 'build'], options);
  if (!existsSync(entry)) throw new Error(`memory-mcp dist still missing after build: ${entry}`);
  return entry;
}
