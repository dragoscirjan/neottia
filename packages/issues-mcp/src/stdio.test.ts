import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ISSUE_TOOLS, issueToolJsonSchema } from '@neottia/issues';
import { createTempIssueProject, repoRoot, type TempIssueProject } from '@neottia/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

let client: Client | undefined;
let transport: StdioClientTransport | undefined;
let project: TempIssueProject | undefined;
let packedRoot: string | undefined;
let packedEntry = '';

beforeAll(() => {
  // Package only already-built output; all generated test artifacts stay temporary.
  const root = mkdtempSync(join(tmpdir(), 'neottia-issues-mcp-package-'));
  packedRoot = root;
  const packageRoot = join(repoRoot(), 'packages', 'issues-mcp');
  execFileSync('pnpm', ['pack', '--pack-destination', root], { cwd: packageRoot, stdio: 'pipe' });
  const tarball = readdirSync(root)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(root, name))[0];
  if (!tarball) throw new Error('pnpm pack did not produce an Issues MCP tarball.');
  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n');
  if (!entries.includes('package/dist/cli.js')) throw new Error('Packed Issues MCP omits dist/cli.js.');
  if (!entries.includes('package/package.json')) throw new Error('Packed Issues MCP omits package.json.');
  const extracted = join(root, 'extracted');
  mkdirSync(extracted);
  execFileSync('tar', ['-xzf', tarball, '-C', extracted]);
  const extractedPackage = join(extracted, 'package');
  packedEntry = join(extractedPackage, 'dist', 'cli.js');
  if (!readFileSync(packedEntry, 'utf8').startsWith('#!/usr/bin/env node\n'))
    throw new Error('Packed Issues MCP CLI omits its executable shebang.');
  const manifest = JSON.parse(readFileSync(join(extractedPackage, 'package.json'), 'utf8')) as {
    bin?: Record<string, string>;
  };
  if (manifest.bin?.['issues-mcp'] !== './dist/cli.js') throw new Error('Packed Issues MCP bin is incorrect.');
  linkPackedDependencies(extractedPackage);
});

afterAll(() => {
  if (packedRoot) rmSync(packedRoot, { recursive: true, force: true });
});

afterEach(async () => {
  const currentClient = client;
  const currentTransport = transport;
  const currentProject = project;
  client = undefined;
  transport = undefined;
  project = undefined;
  let shutdownError: unknown;
  let cleanupFailed = false;
  try {
    if (currentClient && currentTransport) {
      const closed = transportClosed(currentTransport);
      await currentClient.close();
      await closed;
    } else if (currentTransport) {
      await currentTransport.close();
    }
  } catch (error: unknown) {
    shutdownError = error;
  } finally {
    currentProject?.cleanup();
    cleanupFailed = currentProject !== undefined && existsSync(currentProject.cwd);
  }
  if (shutdownError !== undefined) throw shutdownError;
  if (cleanupFailed) throw new Error('Temporary MCP project cleanup failed.');
});

/** Connects a generic SDK client to the extracted package executable. */
async function connect(extra: Parameters<typeof createTempIssueProject>[0] = {}): Promise<void> {
  project = createTempIssueProject(extra);
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [packedEntry],
    cwd: project.cwd,
    stderr: 'pipe',
  });
  client = new Client({ name: 'issues-stdio-integration', version: '1.0.0' });
  await client.connect(transport);
  if (transport.pid === null) throw new Error('Packaged MCP process did not start.');
}

describe('packaged Issues MCP over stdio', () => {
  it('discovers contracts and returns schema-shaped calls and structured errors', async () => {
    await connect();
    const connected = client as Client;
    const listed = await connected.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(ISSUE_TOOLS.map((tool) => tool.name));
    for (const definition of ISSUE_TOOLS) {
      const published = listed.tools.find((tool) => tool.name === definition.name);
      expect(published?.inputSchema).toEqual(issueToolJsonSchema(definition.name, 'input'));
      expect(published?.outputSchema).toEqual(issueToolJsonSchema(definition.name, 'output'));
    }

    const created = await connected.callTool({
      name: 'issue_create',
      arguments: { type: 'task', title: 'Packaged stdio issue' },
    });
    expect(created.isError).toBeFalsy();
    expect(created.structuredContent).toMatchObject({ type: 'task', title: 'Packaged stdio issue' });
    const text = JSON.parse(String((created.content as Array<{ text: string }>)[0]?.text)) as unknown;
    expect(text).toEqual(created.structuredContent);
    const issue = created.structuredContent as { id: string };
    const fetched = await connected.callTool({ name: 'issue_get', arguments: { id: issue.id } });
    expect(fetched.structuredContent).toMatchObject({ id: issue.id, title: 'Packaged stdio issue' });

    const invalid = await connected.callTool({ name: 'issue_get', arguments: {} });
    expect(invalid.isError).toBe(true);
    expect(JSON.parse(String((invalid.content as Array<{ text: string }>)[0]?.text))).toMatchObject({
      category: 'validation',
      code: 'TOOL_INPUT_INVALID',
      retryable: false,
    });
    const unknown = await connected.callTool({ name: 'not_a_tool', arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(JSON.parse(String((unknown.content as Array<{ text: string }>)[0]?.text))).toMatchObject({
      category: 'validation',
      code: 'TOOL_NOT_FOUND',
      retryable: false,
    });
  });

  it('preserves noninteractive stale policy failures', async () => {
    await connect({ issues: { cache: { stale_policy: 'fail' } } });
    const connected = client as Client;
    await connected.callTool({ name: 'issue_create', arguments: { type: 'task', title: 'No implicit rebuild' } });
    const search = await connected.callTool({ name: 'issue_search', arguments: { query: 'rebuild' } });
    expect(search.isError).toBe(true);
    expect(JSON.parse(String((search.content as Array<{ text: string }>)[0]?.text))).toMatchObject({
      category: 'storage',
      code: 'ISSUE_CACHE_REBUILD_REQUIRED',
      retryable: false,
      details: { reason: 'missing' },
    });
  });

  it('exits cleanly when the stdio client closes its input', async () => {
    project = createTempIssueProject();
    const child = spawn(process.execPath, [packedEntry], {
      cwd: project.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end();
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveExit, rejectExit) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          rejectExit(new Error('Packaged MCP CLI did not exit after stdin closed.'));
        }, 5_000);
        child.once('error', rejectExit);
        child.once('exit', (code, signal) => {
          clearTimeout(timer);
          resolveExit({ code, signal });
        });
      },
    );
    expect(exit).toEqual({ code: 0, signal: null });
  });
});

function linkPackedDependencies(extractedPackage: string): void {
  const modules = join(extractedPackage, 'node_modules');
  mkdirSync(join(modules, '@neottia'), { recursive: true });
  mkdirSync(join(modules, '@modelcontextprotocol'), { recursive: true });
  symlinkSync(join(repoRoot(), 'packages', 'issues'), join(modules, '@neottia', 'issues'), 'dir');
  symlinkSync(
    join(repoRoot(), 'packages', 'issues-mcp', 'node_modules', '@modelcontextprotocol', 'sdk'),
    join(modules, '@modelcontextprotocol', 'sdk'),
    'dir',
  );
}

function transportClosed(current: StdioClientTransport): Promise<void> {
  return new Promise((resolveClosed, rejectClosed) => {
    const previous = current.onclose;
    const timer = setTimeout(() => rejectClosed(new Error('Packaged MCP process did not shut down.')), 5_000);
    current.onclose = () => {
      clearTimeout(timer);
      previous?.();
      resolveClosed();
    };
  });
}
