import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_STORE_LIMITS,
  LeaseContentionError,
  resolveManagedPath,
  resolveManagedRoot,
  withRepositoryLease,
} from '../index.js';
import type { SqliteAdapter } from './adapter.js';
import {
  openDisposableSqliteCache,
  rebuildDisposableSqliteCache,
  type DisposableCacheSpecification,
  type DisposableSqliteCache,
} from './cache.js';
import { nodeSqliteAdapter } from './node.js';
import { setSqliteAdapterForTests } from './runtime.js';
import { setFilesystemFaultInjectorForTests } from '../internal/fault-injection.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  setFilesystemFaultInjectorForTests(undefined);
  setSqliteAdapterForTests(undefined);
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

  it('rejects an initially oversized valid cache before domain verification', async () => {
    const { authority, root, specification } = await newCacheFixture('neottia-cache-active-initial-limit-');
    await withRepositoryLease(root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(root, lease, specification);
      await cache.close();
    });
    const databaseBytes = statSync(join(authority, 'cache.db')).size;
    const constrained = await resolveManagedRoot({
      authorityRoot: authority,
      limits: { ...DEFAULT_STORE_LIMITS, maxTemporaryBytes: databaseBytes - 1 },
    });
    let healthChecked = false;
    const constrainedSpecification = {
      ...specification,
      path: resolveManagedPath(constrained, 'cache.db'),
      async healthCheck(): Promise<void> {
        healthChecked = true;
      },
    };
    await expect(
      withRepositoryLease(constrained, (lease) =>
        openDisposableSqliteCache(constrained, lease, constrainedSpecification),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(healthChecked).toBe(false);
  });

  it('rejects cache growth produced by a domain health check', async () => {
    const { authority, root, specification } = await newCacheFixture('neottia-cache-active-growth-limit-');
    await withRepositoryLease(root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(root, lease, specification);
      await cache.close();
    });
    const constrained = await resolveManagedRoot({
      authorityRoot: authority,
      limits: { ...DEFAULT_STORE_LIMITS, maxTemporaryBytes: 1024 * 1024 },
    });
    const originalHealthCheck = specification.healthCheck;
    const growingSpecification = {
      ...specification,
      path: resolveManagedPath(constrained, 'cache.db'),
      async healthCheck(database: Parameters<typeof originalHealthCheck>[0]): Promise<void> {
        await originalHealthCheck(database);
        await database.exec('CREATE TABLE health_growth (payload BLOB NOT NULL)');
        await database.exec('INSERT INTO health_growth VALUES (zeroblob(2097152))');
      },
    };
    await expect(
      withRepositoryLease(constrained, (lease) => openDisposableSqliteCache(constrained, lease, growingSpecification)),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('accepts the exact cumulative schema SQL byte boundary', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-cache-schema-exact-'));
    temporaryDirectories.push(authority);
    const root = await resolveManagedRoot({
      authorityRoot: authority,
      limits: { ...DEFAULT_STORE_LIMITS, maxSqlBytes: 256 },
    });
    const base = 'CREATE TABLE domain_records (id TEXT PRIMARY KEY, value TEXT NOT NULL);';
    const schema = `${base}${' '.repeat(256 - Buffer.byteLength(base))}`;
    const specification = {
      ...cacheSpecification(resolveManagedPath(root, 'cache.db'), 'exact'),
      schemaSql: [schema],
    };
    await withRepositoryLease(root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(root, lease, specification);
      await cache.close();
    });
    expect(existsSync(join(authority, 'cache.db'))).toBe(true);
  });

  it('rejects aggregate domain schema SQL before creating a candidate', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-cache-schema-bound-'));
    temporaryDirectories.push(authority);
    const root = await resolveManagedRoot({
      authorityRoot: authority,
      limits: { ...DEFAULT_STORE_LIMITS, maxSqlBytes: 256 },
    });
    const specification = {
      ...cacheSpecification(resolveManagedPath(root, 'cache.db'), 'digest'),
      schemaSql: [`--${'a'.repeat(148)}`, `--${'b'.repeat(148)}`],
    };
    await withRepositoryLease(root, async (lease) => {
      await expect(rebuildDisposableSqliteCache(root, lease, specification)).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      });
    });
    expect(existsSync(join(authority, 'cache.db'))).toBe(false);
  });

  it('applies the cumulative candidate DB/WAL/SHM boundary inclusively and cleans one-byte-over failure', async () => {
    const baseline = await newCacheFixture('neottia-cache-cumulative-baseline-');
    const originalHealthCheck = baseline.specification.healthCheck;
    let observedBytes = 0;
    const observedSpecification = {
      ...baseline.specification,
      async healthCheck(database: Parameters<typeof originalHealthCheck>[0]) {
        observedBytes = Math.max(observedBytes, candidateArtifactBytes(baseline.authority));
        await originalHealthCheck(database);
        observedBytes = Math.max(observedBytes, candidateArtifactBytes(baseline.authority));
      },
    };
    await withRepositoryLease(baseline.root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(baseline.root, lease, observedSpecification);
      await cache.close();
    });
    expect(observedBytes).toBeGreaterThan(0);

    const runBoundary = async (delta: 0 | -1): Promise<{ failure: unknown; candidates: string[] }> => {
      const authority = mkdtempSync(join(tmpdir(), `neottia-cache-cumulative-${delta}-`));
      temporaryDirectories.push(authority);
      const root = await resolveManagedRoot({
        authorityRoot: authority,
        limits: { ...DEFAULT_STORE_LIMITS, maxTemporaryBytes: observedBytes + delta },
      });
      const specification = cacheSpecification(resolveManagedPath(root, 'cache.db'), `boundary-${delta}`);
      let failure: unknown;
      try {
        await withRepositoryLease(root, async (lease) => {
          const cache = await rebuildDisposableSqliteCache(root, lease, specification);
          await cache.close();
        });
      } catch (error: unknown) {
        failure = error;
      }
      return { failure, candidates: readdirSync(authority).filter((name) => name.includes('.candidate')) };
    };
    const exact = await runBoundary(0);
    expect(exact.failure).toBeUndefined();
    expect(exact.candidates).toEqual([]);
    const over = await runBoundary(-1);
    expect(over.failure).toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(over.candidates).toEqual([]);
  });

  it('removes exact candidate DB/WAL/SHM after cumulative over-limit failure and preserves active cache', async () => {
    const { authority, root, specification } = await newCacheFixture('neottia-cache-candidate-limit-');
    await withRepositoryLease(root, async (lease) => {
      const active = await rebuildDisposableSqliteCache(root, lease, specification);
      await active.close();
    });
    const activePath = join(authority, 'cache.db');
    const before = readFileSync(activePath);
    const constrained = await resolveManagedRoot({
      authorityRoot: authority,
      limits: { ...DEFAULT_STORE_LIMITS, maxTemporaryBytes: 1 },
    });
    const constrainedSpecification = cacheSpecification(resolveManagedPath(constrained, 'cache.db'), 'next');
    await withRepositoryLease(constrained, async (lease) => {
      await expect(rebuildDisposableSqliteCache(constrained, lease, constrainedSpecification)).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      });
    });
    expect(readFileSync(activePath)).toEqual(before);
    expect(readdirSync(authority).filter((name) => name.includes('.candidate'))).toEqual([]);
  });

  it.each(['candidate-file', 'activation-directory'] as const)(
    'reports structured durability and cleans exact cache artifacts for %s fsync',
    async (boundary) => {
      const { authority, root, specification } = await newCacheFixture(`neottia-cache-${boundary}-`);
      const cause = new Error(`injected ${boundary} fsync`);
      const activePath = join(authority, 'cache.db');
      let published = false;
      let failedPath = '';
      let operation = '';
      await withRepositoryLease(root, async (lease) => {
        setFilesystemFaultInjectorForTests((event, target) => {
          if (event === 'exclusive-destination-published' && target === activePath) published = true;
          const candidateFailure =
            boundary === 'candidate-file' && event === 'file-fsync' && target.includes('.candidate');
          const activationFailure =
            boundary === 'activation-directory' && published && event === 'directory-fsync' && target === authority;
          if ((candidateFailure || activationFailure) && failedPath === '') {
            failedPath = target;
            operation = event;
            throw cause;
          }
        });
        let failure: unknown;
        try {
          await rebuildDisposableSqliteCache(root, lease, specification);
        } catch (error: unknown) {
          failure = error;
        }
        expect(failure).toMatchObject({
          category: 'durability',
          code: 'FSYNC_FAILED',
          cause,
          evidence: { operation, path: failedPath },
        });
        setFilesystemFaultInjectorForTests(undefined);
      });
      expect(readdirSync(authority).filter((name) => name.includes('.candidate'))).toEqual([]);
      await withRepositoryLease(root, async (lease) => {
        const repaired = await rebuildDisposableSqliteCache(root, lease, specification);
        await repaired.close();
      });
      expect(readFileSync(activePath).subarray(0, 15).toString()).toBe('SQLite format 3');
    },
  );

  it.each(['before-exact-publication', 'destination-evacuated', 'exclusive-destination-published'] as const)(
    'recovers cache activation killed at %s before rebuilding',
    async (event) => {
      const authority = mkdtempSync(join(tmpdir(), 'neottia-cache-publication-crash-'));
      temporaryDirectories.push(authority);
      const worker = fileURLToPath(new URL('../../test/cache-crash.mjs', import.meta.url));
      const child = spawnSync(process.execPath, [worker, authority, event]);
      expect(child.signal).toBe('SIGKILL');
      const leasePath = join(authority, '.neottia', 'repository-store', 'authority.lease');
      utimesSync(leasePath, new Date(0), new Date(0));

      const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
      const specification = cacheSpecification(resolveManagedPath(root, 'cache.db'), 'replacement');
      await withRepositoryLease(
        root,
        async (lease) => {
          const rebuilt = await rebuildDisposableSqliteCache(root, lease, specification);
          await rebuilt.close();
          const opened = await openDisposableSqliteCache(root, lease, specification);
          expect(opened.state).toBe('ready');
          if (opened.state === 'ready') await opened.close();
        },
        { staleMs: 1 },
      );
      expect(readFileSync(join(authority, 'cache.db')).subarray(0, 15).toString()).toBe('SQLite format 3');
      const publications = join(authority, '.neottia', 'repository-store', 'cache-publications');
      expect(
        readdirSync(publications, { recursive: true }).filter((name) => /\.(?:prepare|active|cleanup)$/u.test(name)),
      ).toEqual([]);
    },
    30_000,
  );

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

  it('holds the lease until a started handle operation settles', async () => {
    const started = deferred();
    const release = deferred();
    setSqliteAdapterForTests(delayedPrepareAdapter(started, release));
    const { root, specification } = await newCacheFixture('neottia-cache-pending-lease-');
    let cache: DisposableSqliteCache | undefined;
    let operation: Promise<unknown> | undefined;
    const first = withRepositoryLease(root, async (lease) => {
      cache = await rebuildDisposableSqliteCache(root, lease, specification);
      operation = cache.database.prepare('SELECT 1 /* pending identity check */');
      await started.promise;
    });
    await started.promise;
    let secondEntered = false;
    const second = withRepositoryLease(root, async () => {
      secondEntered = true;
    });
    expect(secondEntered).toBe(false);
    release.resolve();
    await Promise.all([first, second, operation]);
    expect(secondEntered).toBe(true);
    await cache?.close();
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

  it.each(['', '-wal', '-shm'])('rejects %s replacement while a handle operation is pending', async (suffix) => {
    const started = deferred();
    const release = deferred();
    setSqliteAdapterForTests(delayedPrepareAdapter(started, release));
    const { authority, root, specification } = await newCacheFixture('neottia-cache-pending-operation-');
    await withRepositoryLease(root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(root, lease, specification);
      const operation = cache.database.prepare('SELECT 1 /* pending identity check */');
      await started.promise;
      const artifact = join(authority, `cache.db${suffix}`);
      replaceWithSentinel(artifact);
      release.resolve();
      await expect(operation).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
      expect(readFileSync(artifact, 'utf8')).toBe('replacement');
      await expect(cache.close()).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
    });
  });

  it('rejects candidate replacement while close remains pending', async () => {
    const started = deferred();
    const release = deferred();
    setSqliteAdapterForTests(delayedCandidateCloseAdapter(started, release));
    const { authority, root, specification } = await newCacheFixture('neottia-cache-pending-close-');
    await withRepositoryLease(root, async (lease) => {
      const rebuild = rebuildDisposableSqliteCache(root, lease, specification);
      await started.promise;
      const candidate = readdirSync(authority).find((name) => name.endsWith('.candidate'));
      expect(candidate).toBeDefined();
      const candidatePath = join(authority, candidate as string);
      replaceWithSentinel(candidatePath);
      release.resolve();
      await expect(rebuild).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
      expect(readFileSync(candidatePath, 'utf8')).toBe('replacement');
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

  it('preserves a replacement injected at the final activation mutation', async () => {
    const { authority, root, path, specification } = await newCacheFixture('neottia-cache-final-activation-');
    const activePath = join(authority, 'cache.db');
    await withRepositoryLease(root, async (lease) => {
      const active = await rebuildDisposableSqliteCache(root, lease, specification);
      await active.close();
    });
    setFilesystemFaultInjectorForTests((event, target) => {
      if (event === 'before-exact-publication' && target === activePath) replaceWithSentinel(activePath);
    });
    await withRepositoryLease(root, async (lease) => {
      let failure: unknown;
      try {
        await rebuildDisposableSqliteCache(
          root,
          lease,
          cacheSpecification(path, `${specification.canonicalDigest}-new`),
        );
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: 'IDENTITY_CHANGED' });
    });
    expect(readFileSync(activePath, 'utf8')).toBe('replacement');
  });

  it('preserves cancellation raised during a domain health check', async () => {
    const { root, specification } = await newCacheFixture('neottia-cache-cancel-');
    await withRepositoryLease(root, async (lease) => {
      const cache = await rebuildDisposableSqliteCache(root, lease, specification);
      await cache.close();
      const cancelled = cacheSpecification(specification.path, specification.canonicalDigest);
      cancelled.healthCheck = async () => {
        throw new LeaseContentionError('cancelled health check', 'ABORTED');
      };
      await expect(openDisposableSqliteCache(root, lease, cancelled)).rejects.toMatchObject({ code: 'ABORTED' });
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

function delayedPrepareAdapter(started: Deferred, release: Deferred): SqliteAdapter {
  return {
    runtime: 'node',
    async open(path, options) {
      const database = await nodeSqliteAdapter.open(path, options);
      return {
        exec: (sql) => database.exec(sql),
        async prepare(sql) {
          if (sql === 'SELECT 1 /* pending identity check */') {
            started.resolve();
            await release.promise;
          }
          return database.prepare(sql);
        },
        close: () => database.close(),
      };
    },
  };
}

function delayedCandidateCloseAdapter(started: Deferred, release: Deferred): SqliteAdapter {
  let delayed = false;
  return {
    runtime: 'node',
    async open(path, options) {
      const database = await nodeSqliteAdapter.open(path, options);
      return {
        exec: (sql) => database.exec(sql),
        prepare: (sql) => database.prepare(sql),
        async close() {
          await database.close();
          if (!delayed && path.endsWith('.candidate')) {
            delayed = true;
            started.resolve();
            await release.promise;
          }
        },
      };
    },
  };
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function candidateArtifactBytes(authority: string): number {
  const names = readdirSync(authority);
  const candidate = names.find((name) => name.endsWith('.candidate'));
  if (candidate === undefined) return 0;
  return names
    .filter((name) => name === candidate || name === `${candidate}-wal` || name === `${candidate}-shm`)
    .reduce((total, name) => total + statSync(join(authority, name)).size, 0);
}

function replaceWithSentinel(path: string): void {
  expect(existsSync(path)).toBe(true);
  const replacement = `${path}.replacement`;
  writeFileSync(replacement, 'replacement');
  renameSync(replacement, path);
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
