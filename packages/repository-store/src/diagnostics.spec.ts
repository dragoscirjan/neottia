import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { diagnoseRepositoryPlatform } from './diagnostics.js';
import { repositoryPlatformTupleSupport, setRepositoryPlatformBackendForTests } from './internal/platform-backend.js';

const roots: string[] = [];

afterEach(async () => {
  setRepositoryPlatformBackendForTests(undefined);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Repository Store platform diagnostics', () => {
  it('distinguishes unsupported platforms, architectures, and runtimes', () => {
    expect(repositoryPlatformTupleSupport('aix', 'x64', 'node')).toEqual({
      platformKnown: false,
      architectureCertified: false,
      runtimeCertified: false,
      certified: false,
    });
    expect(repositoryPlatformTupleSupport('win32', 'arm64', 'node')).toEqual({
      platformKnown: true,
      architectureCertified: false,
      runtimeCertified: true,
      certified: false,
    });
    expect(repositoryPlatformTupleSupport('freebsd', 'x64', 'bun')).toEqual({
      platformKnown: true,
      architectureCertified: true,
      runtimeCertified: false,
      certified: false,
    });
  });

  it('reports every certified capability and removes its private probe area', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neottia-platform-diagnostics-'));
    roots.push(root);
    const before = await readdir(root);

    const report = await diagnoseRepositoryPlatform(root);

    expect(report.status).toBe('pass');
    expect(report.backend.available).toBe(true);
    expect(report.filesystem.type).not.toBeNull();
    expect(report.checks.map((check) => check.id)).toEqual([
      'platform',
      'architecture',
      'runtime',
      'native-backend',
      'filesystem-type',
      'filesystem-local',
      'filesystem-writable',
      'atomic-no-replace',
      'hard-links',
      'stable-identity',
      'file-durability',
      'directory-durability',
    ]);
    expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
    expect(await readdir(root)).toEqual(before);
    expect(JSON.stringify(report)).not.toContain(root);
    expect(await readdir(root)).not.toContain('.neottia');
  });

  it('reports an unavailable native addon without creating artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neottia-platform-diagnostics-unavailable-'));
    roots.push(root);
    setRepositoryPlatformBackendForTests(null);

    const report = await diagnoseRepositoryPlatform(root);

    expect(report.status).toBe('fail');
    expect(report.backend.available).toBe(false);
    expect(report.checks.find((check) => check.id === 'native-backend')).toMatchObject({
      status: 'fail',
      reason: 'NATIVE_ADDON_UNAVAILABLE',
    });
    expect(await readdir(root)).toEqual([]);
  });
});
