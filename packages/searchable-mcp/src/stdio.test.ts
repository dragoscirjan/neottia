import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SEARCHABLE_TOOLS, searchableToolJsonSchema } from '@neottia/searchable-core';
import { repoRoot } from '@neottia/testkit';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

let packageRoot = '';
let packedEntry = '';
let project = '';
let client: Client | undefined;
let transport: StdioClientTransport | undefined;

beforeAll(() => {
  packageRoot = mkdtempSync(join(tmpdir(), 'searchable-mcp-package-'));
  const tarballs = {
    'repository-store': pack('packages/repository-store'),
    'searchable-core': pack('packages/searchable-core'),
    'searchable-mcp': pack('packages/searchable-mcp'),
    'pi-searchable': pack('extensions/pi-searchable'),
    'opencode-searchable': pack('extensions/opencode-searchable'),
  };
  const mcpTarball = tarballs['searchable-mcp'];
  if (!mcpTarball) throw new Error('pnpm pack did not produce a Searchable MCP tarball.');
  const entries = execFileSync('tar', ['-tzf', mcpTarball], { encoding: 'utf8' }).split('\n');
  if (!entries.includes('package/dist/cli.js')) throw new Error('Packed Searchable MCP omits dist/cli.js.');
  for (const name of ['pi-searchable', 'opencode-searchable'] as const) {
    const adapterEntries = execFileSync('tar', ['-tzf', tarballs[name]], { encoding: 'utf8' }).split('\n');
    if (!adapterEntries.includes('package/src/index.ts'))
      throw new Error(`Packed ${name} omits its TypeScript entry point.`);
  }
  const extracted = join(packageRoot, 'extracted');
  const packedRepositoryStore = extract(tarballs['repository-store'], join(extracted, 'repository-store'));
  const packedCore = extract(tarballs['searchable-core'], join(extracted, 'searchable-core'));
  const packedPackage = extract(mcpTarball, join(extracted, 'searchable-mcp'));
  linkDependency(packedPackage, '@neottia/searchable-core', packedCore);
  linkDependency(packedCore, '@neottia/repository-store', packedRepositoryStore);
  for (const dependency of ['@mozilla/readability', 'jsdom', 'turndown', 'yaml', 'zod'])
    linkWorkspaceDependency(packedCore, 'packages/searchable-core', dependency);
  linkWorkspaceDependency(packedPackage, 'packages/searchable-mcp', '@modelcontextprotocol/sdk');
  execFileSync('node', ['scripts/install-native.mjs'], {
    cwd: packedRepositoryStore,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${join(repoRoot(), 'packages', 'repository-store', 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    },
  });
  packedEntry = join(packedPackage, 'dist', 'cli.js');
  if (!readFileSync(packedEntry, 'utf8').startsWith('#!/usr/bin/env node\n'))
    throw new Error('Packed Searchable MCP CLI omits its executable shebang.');
  const manifest = JSON.parse(readFileSync(join(packedPackage, 'package.json'), 'utf8')) as {
    bin?: Record<string, string>;
  };
  if (manifest.bin?.['searchable-mcp'] !== './dist/cli.js') throw new Error('Packed Searchable MCP bin is incorrect.');
});

afterEach(async () => {
  const activeTransport = transport;
  transport = undefined;
  try {
    if (client) await client.close();
    else if (activeTransport) await activeTransport.close();
  } finally {
    client = undefined;
    if (project) rmSync(project, { recursive: true, force: true });
    project = '';
  }
});

afterAll(() => {
  if (packageRoot) rmSync(packageRoot, { recursive: true, force: true });
});

it('discovers shared contracts and executes canonical storage from the packed CLI', async () => {
  await connect();
  const connected = client as Client;
  const listed = await connected.listTools();
  expect(listed.tools.map((tool) => tool.name)).toEqual(SEARCHABLE_TOOLS.map((tool) => tool.name));
  for (const definition of SEARCHABLE_TOOLS) {
    const published = listed.tools.find((tool) => tool.name === definition.name);
    expect(published?.inputSchema).toEqual(searchableToolJsonSchema(definition.name, 'input'));
    expect(published?.outputSchema).toEqual(searchableToolJsonSchema(definition.name, 'output'));
  }
  const stashed = await connected.callTool({
    name: 'web_stash',
    arguments: { url: 'https://example.com/packed', title: 'Packed', content: 'packaged marker content' },
  });
  expect(stashed.structuredContent).toEqual({ stashed: true, url: 'https://example.com/packed' });
  const grep = await connected.callTool({ name: 'web_grep', arguments: { query: 'marker' } });
  expect(grep.structuredContent).toMatchObject({ results: [{ title: 'Packed' }] });
  expect(existsSync(join(project, '.neottia', 'searchable', 'pages'))).toBe(true);
});

it('exits cleanly when packaged stdio input closes', async () => {
  project = createProject();
  const child = spawn(process.execPath, [packedEntry], { cwd: project, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectExit(new Error('Packaged Searchable MCP did not exit after stdin closed.'));
    }, 5_000);
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
  expect(exit).toEqual({ code: 0, signal: null });
});

async function connect(): Promise<void> {
  project = createProject();
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [packedEntry],
    cwd: project,
    stderr: 'pipe',
  });
  client = new Client({ name: 'searchable-stdio-integration', version: '1' });
  await client.connect(transport);
  if (transport.pid === null) throw new Error('Packaged Searchable MCP process did not start.');
}

function createProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-mcp-project-'));
  mkdirSync(join(cwd, '.neottia'));
  writeFileSync(join(cwd, '.neottia', 'config.yml'), 'version: 1\nskills:\n  searchable:\n    enabled: true\n');
  return cwd;
}

function pack(relativePath: string): string {
  const output = execFileSync('pnpm', ['pack', '--pack-destination', packageRoot], {
    cwd: join(repoRoot(), relativePath),
    encoding: 'utf8',
  }).trim();
  return resolve(packageRoot, output.split('\n').at(-1) as string);
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

function linkWorkspaceDependency(parent: string, workspacePath: string, dependency: string): void {
  linkDependency(parent, dependency, join(repoRoot(), workspacePath, 'node_modules', dependency));
}
