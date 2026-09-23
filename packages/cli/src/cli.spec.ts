import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveConfig, ConfigResolutionError } from '@neottia/config';
import { officialConfigRegistry } from '@neottia/config-registry';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { main, type CliOutput } from './index.js';

/* Keeps the real resolver for every test except the one that forces a validation failure. */
vi.mock('@neottia/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neottia/config')>();
  return { ...actual, resolveConfig: vi.fn(actual.resolveConfig) };
});

const roots: string[] = [];

/** Captures CLI output without changing process streams. */
function capture(): { output: CliOutput; logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    output: {
      log(message) {
        logs.push(message);
      },
      error(message) {
        errors.push(message);
      },
    },
  };
}

/** Creates one disposable project root. */
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'neottia-cli-init-'));
  roots.push(root);
  return root;
}

/** Resolves only the generated project document through the official registry. */
function resolveGeneratedConfig(root: string) {
  return resolveConfig(officialConfigRegistry, {
    cwd: root,
    env: {},
    globalFile: false,
  });
}

/** The required current-agent assignments written for every harness. */
function requiredRoleAssignments() {
  return {
    planner: { agent: 'current' },
    implementer: { agent: 'current' },
    verifier: { agent: 'current' },
    'release-coordinator': { agent: 'current' },
  };
}

/** Reports whether one path currently exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Neottia CLI', () => {
  it('documents initialization and the explicit plan and apply workflow', async () => {
    const result = capture();
    expect(await main(['help'], result.output)).toBe(0);
    expect(result.logs.join('\n')).toContain('neottia init');
    expect(result.logs.join('\n')).toContain('neottia plan');
    expect(result.logs.join('\n')).toContain('neottia apply');
  });

  it('initializes one project-local Pi configuration and creates the missing config directory', async () => {
    const root = await fixture();
    const result = capture();

    expect(await main(['init', '--harness', 'pi', '--project', root], result.output)).toBe(0);

    const configPath = join(root, '.neottia', 'config.yml');
    expect(result.errors).toEqual([]);
    expect(result.logs).toEqual([
      `Created ${configPath}`,
      'Harnesses: pi',
      'Next: neottia plan --manifest <manifest.json> --output install.plan.json',
    ]);
    expect(resolveGeneratedConfig(root).toJSON()).toMatchObject({
      version: 1,
      modules: {
        issues: { enabled: true },
        design_docs: { enabled: true },
      },
      capabilities: {
        issues: { provider: 'filesystem' },
        documents: { provider: 'filesystem' },
        source_control: { local: 'git', remote: false, workspaces: false },
      },
      harnesses: { install: { targets: [{ id: 'pi', scope: 'project' }] } },
      agents: {
        sdlc: {
          pi: requiredRoleAssignments(),
        },
      },
    });
  });

  // Windows does not implement POSIX owner/group/other permission bits.
  it.skipIf(process.platform === 'win32')('writes the configuration with owner-only permissions', async () => {
    const root = await fixture();

    expect(await main(['init', '--harness', 'pi', '--project', root], capture().output)).toBe(0);

    expect((await stat(join(root, '.neottia', 'config.yml'))).mode & 0o777).toBe(0o600);
  });

  it('writes canonical multi-harness output independent of argument order', async () => {
    const first = await fixture();
    const second = await fixture();

    expect(await main(['init', '--harness', 'pi', '--harness', 'opencode', '--project', first], capture().output)).toBe(
      0,
    );
    expect(
      await main(['init', '--harness', 'opencode', '--harness', 'pi', '--project', second], capture().output),
    ).toBe(0);

    const firstContent = await readFile(join(first, '.neottia', 'config.yml'), 'utf8');
    const secondContent = await readFile(join(second, '.neottia', 'config.yml'), 'utf8');
    expect(firstContent).toBe(secondContent);
    expect(resolveGeneratedConfig(first).toJSON()).toMatchObject({
      harnesses: {
        install: {
          targets: [
            { id: 'opencode', scope: 'project' },
            { id: 'pi', scope: 'project' },
          ],
        },
      },
      agents: {
        sdlc: {
          opencode: requiredRoleAssignments(),
          pi: requiredRoleAssignments(),
        },
      },
    });
  });

  it('deduplicates repeated harness values', async () => {
    const root = await fixture();

    expect(await main(['init', '--harness', 'pi', '--harness', 'pi', '--project', root], capture().output)).toBe(0);

    expect(resolveGeneratedConfig(root).toJSON()).toMatchObject({
      harnesses: { install: { targets: [{ id: 'pi', scope: 'project' }] } },
    });
  });

  it('refuses to replace an existing configuration', async () => {
    const root = await fixture();
    const directory = join(root, '.neottia');
    const configPath = join(directory, 'config.yml');
    await mkdir(directory);
    await writeFile(configPath, 'version: 1\n# user-owned\n', 'utf8');
    const result = capture();

    expect(await main(['init', '--harness', 'pi', '--project', root], result.output)).toBe(1);

    expect(await readFile(configPath, 'utf8')).toBe('version: 1\n# user-owned\n');
    expect(result.errors).toEqual([`Configuration already exists: ${configPath}`]);
    expect(await readdir(directory)).toEqual(['config.yml']);
  });

  it('reports registry validation failure without writing the configuration', async () => {
    const root = await fixture();
    const result = capture();
    vi.mocked(resolveConfig).mockImplementationOnce(() => {
      throw new ConfigResolutionError([
        { code: 'VERSION', message: 'configuration version must be the supported integer version 1' },
      ]);
    });

    expect(await main(['init', '--harness', 'pi', '--project', root], result.output)).toBe(1);

    expect(result.errors.join('\n')).toContain('Configuration resolution failed');
    expect(await exists(join(root, '.neottia'))).toBe(false);
  });

  it.each([
    [['init'], 'init requires at least one --harness.'],
    [['init', '--harness', 'claude-code'], 'Unsupported init harness: claude-code. Expected one of: opencode, pi.'],
  ] as const)('rejects invalid harness selection before mutation', async (arguments_, message) => {
    const root = await fixture();
    const result = capture();

    expect(await main([...arguments_, '--project', root], result.output)).toBe(1);

    expect(result.errors).toEqual([message]);
    expect(await exists(join(root, '.neottia'))).toBe(false);
  });

  it('returns a failure for an unknown command', async () => {
    const result = capture();
    expect(await main(['unknown'], result.output)).toBe(1);
    expect(result.errors).toEqual(['Unknown command: unknown']);
  });
});
