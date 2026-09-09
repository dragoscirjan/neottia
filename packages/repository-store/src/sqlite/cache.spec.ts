import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STORE_LIMITS, resolveManagedPath, resolveManagedRoot, withRepositoryLease } from '../index.js';
import {
  openDisposableSqliteCache,
  rebuildDisposableSqliteCache,
  type DisposableCacheSpecification,
  type DisposableSqliteCache,
} from './cache.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0)
    rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
});

describe('disposable SQLite cache', () => {
  it('rebuilds a missing cache and verifies its canonical digest and domain health', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-cache-'));
    temporaryDirectories.push(authority);
    const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
    const specification = cacheSpecification(resolveManagedPath(root, 'cache.db'), 'digest-one');
    await withRepositoryLease(root, async (lease) => {
      await expect(openDisposableSqliteCache(root, lease, specification)).resolves.toEqual({
        state: 'rebuild-required',
        reason: 'missing',
      });
      const rebuilt = await rebuildDisposableSqliteCache(root, lease, specification);
      await rebuilt.close();
      const opened = await openDisposableSqliteCache(root, lease, specification);
      expect(opened.state).toBe('ready');
      if (opened.state === 'ready') await opened.close();
      await expect(
        openDisposableSqliteCache(root, lease, cacheSpecification(specification.path, 'digest-two')),
      ).resolves.toEqual({ state: 'rebuild-required', reason: 'stale-digest' });
    });
  });

  it('invalidates writable handles after lease settlement while still allowing close', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-cache-lease-'));
    temporaryDirectories.push(authority);
    const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
    const specification = cacheSpecification(resolveManagedPath(root, 'cache.db'), 'digest');
    let escaped: DisposableSqliteCache | undefined;
    await withRepositoryLease(root, async (lease) => {
      escaped = await rebuildDisposableSqliteCache(root, lease, specification);
    });
    await expect(escaped?.database.prepare('SELECT 1')).rejects.toMatchObject({ code: 'LEASE_BUSY' });
    await expect(escaped?.close()).resolves.toBeUndefined();
  });

  it('does not activate a candidate when cancellation arrives during population', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-cache-abort-'));
    temporaryDirectories.push(authority);
    const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
    const path = resolveManagedPath(root, 'cache.db');
    const original = cacheSpecification(path, 'original');
    await withRepositoryLease(root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(root, lease, original);
      await cache.close();
    });
    const controller = new AbortController();
    const replacement = cacheSpecification(path, 'replacement');
    replacement.populate = async (database) => {
      const insert = await database.prepare('INSERT INTO domain_records (id, value) VALUES (?, ?)');
      await insert.run(['one', 'canonical']);
      controller.abort();
    };
    await expect(
      withRepositoryLease(root, async (lease) =>
        rebuildDisposableSqliteCache(root, lease, replacement, { signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    await withRepositoryLease(root, async (lease) => {
      const opened = await openDisposableSqliteCache(root, lease, original);
      expect(opened.state).toBe('ready');
      if (opened.state === 'ready') await opened.close();
    });
  });

  it('detects database replacement while an acquired handle is in use', async () => {
    const { authority, root, specification } = await newCacheFixture('neottia-cache-identity-');
    await withRepositoryLease(root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(root, lease, specification);
      rmSync(join(authority, 'cache.db'));
      writeFileSync(join(authority, 'cache.db'), 'replacement');
      await expect(cache.database.prepare('SELECT 1')).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
      await expect(cache.close()).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
      expect(readFileSync(join(authority, 'cache.db'), 'utf8')).toBe('replacement');
    });
  });

  it.each(['-wal', '-shm'])('detects %s replacement while a cache handle is in use', async (suffix) => {
    const { authority, root, specification } = await newCacheFixture('neottia-cache-sidecar-');
    await withRepositoryLease(root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(root, lease, specification);
      const sidecar = join(authority, `cache.db${suffix}`);
      expect(existsSync(sidecar)).toBe(true);
      rmSync(sidecar);
      writeFileSync(sidecar, 'replacement');
      await expect(cache.database.prepare('SELECT 1')).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
      await expect(cache.close()).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
      expect(readFileSync(sidecar, 'utf8')).toBe('replacement');
    });
  });

  it.each(['', '-wal', '-shm'])('preserves an active %s replacement detected before activation', async (suffix) => {
    const { authority, root, path, specification } = await newCacheFixture('neottia-cache-activation-');
    await withRepositoryLease(root, async (lease) => {
      const active = await rebuildDisposableSqliteCache(root, lease, specification);
      const replacement = cacheSpecification(path, 'replacement-digest');
      const populate = replacement.populate;
      replacement.populate = async (database) => {
        await populate(database);
        replaceWithSentinel(join(authority, `cache.db${suffix}`));
      };
      await expect(rebuildDisposableSqliteCache(root, lease, replacement)).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
      });
      expect(readFileSync(join(authority, `cache.db${suffix}`), 'utf8')).toBe('replacement');
      await expect(active.close()).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
      expect(readFileSync(join(authority, `cache.db${suffix}`), 'utf8')).toBe('replacement');
    });
  });

  it.each(['', '-wal', '-shm'])('does not close SQLite over a %s replacement during verification', async (suffix) => {
    const { authority, root, path, specification } = await newCacheFixture('neottia-cache-verification-');
    await withRepositoryLease(root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(root, lease, specification);
      await cache.close();
      const adversarial = cacheSpecification(path, specification.canonicalDigest);
      const healthCheck = adversarial.healthCheck;
      adversarial.healthCheck = async (database) => {
        await healthCheck(database);
        replaceWithSentinel(join(authority, `cache.db${suffix}`));
      };
      await expect(openDisposableSqliteCache(root, lease, adversarial)).rejects.toMatchObject({
        code: 'IDENTITY_CHANGED',
      });
      expect(readFileSync(join(authority, `cache.db${suffix}`), 'utf8')).toBe('replacement');
    });
  });

  it('detects cache ancestor rebinding around handle operations', async () => {
    const container = mkdtempSync(join(tmpdir(), 'neottia-cache-ancestor-'));
    temporaryDirectories.push(container);
    const authority = join(container, 'authority');
    const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
    const specification = cacheSpecification(resolveManagedPath(root, 'cache.db'), 'digest');
    await withRepositoryLease(root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(root, lease, specification);
      renameSync(authority, join(container, 'displaced'));
      mkdirSync(authority);
      await expect(cache.database.prepare('SELECT 1')).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
      await expect(cache.close()).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
    });
  });

  it('classifies corrupt bytes as rebuildable without changing canonical files', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-cache-corrupt-'));
    temporaryDirectories.push(authority);
    const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
    const path = resolveManagedPath(root, 'cache.db');
    writeFileSync(join(authority, 'cache.db'), 'not sqlite');
    await withRepositoryLease(root, async (lease) => {
      await expect(openDisposableSqliteCache(root, lease, cacheSpecification(path, 'digest'))).resolves.toEqual({
        state: 'rebuild-required',
        reason: 'corrupt',
      });
    });
  });
});

function replaceWithSentinel(path: string): void {
  expect(existsSync(path)).toBe(true);
  rmSync(path);
  writeFileSync(path, 'replacement');
}

async function newCacheFixture(prefix: string, digest = 'digest') {
  const authority = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(authority);
  const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
  const path = resolveManagedPath(root, 'cache.db');
  return { authority, root, path, specification: cacheSpecification(path, digest) };
}

function cacheSpecification(
  path: ReturnType<typeof resolveManagedPath>,
  canonicalDigest: string,
): DisposableCacheSpecification {
  return {
    path,
    applicationId: 0x4e454f54,
    schemaVersion: 1,
    canonicalDigest,
    schemaSql: ['CREATE TABLE domain_records (id TEXT PRIMARY KEY, value TEXT NOT NULL);'],
    async populate(database) {
      const insert = await database.prepare('INSERT INTO domain_records (id, value) VALUES (?, ?)');
      await insert.run(['one', 'canonical']);
    },
    async healthCheck(database) {
      const row = await (
        await database.prepare('SELECT value FROM domain_records WHERE id=?')
      ).get<{
        value: string;
      }>(['one']);
      if (row?.value !== 'canonical') throw new Error('contradictory cache');
    },
  };
}
