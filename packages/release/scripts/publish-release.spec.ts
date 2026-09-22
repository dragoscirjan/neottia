import { describe, expect, it, vi } from 'vitest';

import { publishPreparedRelease } from './publish-release.mjs';

type RegistryVersions = Record<string, string[]>;

/** Creates a public-registry stub from package names and available versions. */
function registryFetch(packages: RegistryVersions) {
  return vi.fn(async (url: string | URL | Request) => {
    const packageName = decodeURIComponent(String(url).split('/').at(-1) ?? '');
    const versions = packages[packageName];
    if (!versions) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    return Response.json({
      name: packageName,
      versions: Object.fromEntries(versions.map((version) => [version, { version }])),
    });
  });
}

const manifest = {
  name: '@neottia/release',
  version: '0.2.0',
  dependencies: {
    '@neottia/core': 'workspace:0.1.0',
    '@neottia/config': 'workspace:0.2.0',
  },
};

describe('publishPreparedRelease', () => {
  it('skips a global release version that is already public', async () => {
    const fetchImpl = registryFetch({ '@neottia/release': ['0.2.0'] });
    const spawnImpl = vi.fn();

    await expect(publishPreparedRelease({ manifest, fetchImpl, spawnImpl, log: vi.fn() })).resolves.toBe('skipped');
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('publishes after every exact module version is public', async () => {
    const fetchImpl = registryFetch({
      '@neottia/core': ['0.1.0'],
      '@neottia/config': ['0.2.0'],
    });
    const spawnImpl = vi.fn(() => ({ status: 0 }));

    await expect(
      publishPreparedRelease({
        manifest,
        packageDirectory: '/tmp/release-package',
        registry: 'https://registry.npmjs.org',
        environment: { NODE_AUTH_TOKEN: 'test-token' },
        fetchImpl,
        spawnImpl,
        log: vi.fn(),
      }),
    ).resolves.toBe('published');
    expect(spawnImpl).toHaveBeenCalledWith(
      'pnpm',
      ['publish', '--access', 'public', '--no-git-checks', '--registry', 'https://registry.npmjs.org'],
      expect.objectContaining({ cwd: '/tmp/release-package' }),
    );
  });

  it('waits for a newly published module to become publicly readable', async () => {
    const fetchImpl = registryFetch({ '@neottia/config': ['0.2.0'] });
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
      .mockResolvedValueOnce(Response.json({ name: '@neottia/core', versions: { '0.1.0': { version: '0.1.0' } } }));
    const delayImpl = vi.fn(async () => undefined);

    await expect(
      publishPreparedRelease({
        manifest,
        environment: { NODE_AUTH_TOKEN: 'test-token' },
        fetchImpl,
        spawnImpl: vi.fn(() => ({ status: 0 })),
        delayImpl,
        maxAttempts: 2,
        retryDelayMs: 1,
        log: vi.fn(),
      }),
    ).resolves.toBe('published');
    expect(delayImpl).toHaveBeenCalledOnce();
  });

  it('retries transient registry failures while waiting for modules', async () => {
    const fetchImpl = registryFetch({ '@neottia/config': ['0.2.0'] });
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(Response.json({ name: '@neottia/core', versions: { '0.1.0': { version: '0.1.0' } } }));
    const delayImpl = vi.fn(async () => undefined);

    await expect(
      publishPreparedRelease({
        manifest,
        environment: { NODE_AUTH_TOKEN: 'test-token' },
        fetchImpl,
        spawnImpl: vi.fn(() => ({ status: 0 })),
        delayImpl,
        maxAttempts: 2,
        retryDelayMs: 1,
        log: vi.fn(),
      }),
    ).resolves.toBe('published');
    expect(delayImpl).toHaveBeenCalledOnce();
  });

  it('rejects non-retryable registry responses immediately', async () => {
    const fetchImpl = registryFetch({});
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
    const delayImpl = vi.fn(async () => undefined);
    const spawnImpl = vi.fn();

    await expect(
      publishPreparedRelease({
        manifest,
        environment: { NODE_AUTH_TOKEN: 'test-token' },
        fetchImpl,
        spawnImpl,
        delayImpl,
        maxAttempts: 3,
        retryDelayMs: 1,
        log: vi.fn(),
      }),
    ).rejects.toThrow('npm returned HTTP 401 for @neottia/core.');
    expect(delayImpl).not.toHaveBeenCalled();
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('rejects publication when a pinned module version stays unavailable', async () => {
    const fetchImpl = registryFetch({ '@neottia/config': ['0.2.0'] });
    const spawnImpl = vi.fn();

    await expect(
      publishPreparedRelease({
        manifest,
        environment: { NODE_AUTH_TOKEN: 'test-token' },
        fetchImpl,
        spawnImpl,
        delayImpl: vi.fn(async () => undefined),
        maxAttempts: 2,
        retryDelayMs: 1,
        log: vi.fn(),
      }),
    ).rejects.toThrow('@neottia/core@0.1.0 is not publicly available from npm.');
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('requires exact workspace dependency versions', async () => {
    const spawnImpl = vi.fn();

    await expect(
      publishPreparedRelease({
        manifest: {
          ...manifest,
          dependencies: { '@neottia/core': 'workspace:^0.1.0' },
        },
        environment: { NODE_AUTH_TOKEN: 'test-token' },
        fetchImpl: registryFetch({}),
        spawnImpl,
        log: vi.fn(),
      }),
    ).rejects.toThrow('must use an exact workspace version');
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});
