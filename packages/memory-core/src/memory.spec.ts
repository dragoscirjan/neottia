import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_STORE_LIMITS,
  rebuildDisposableSqliteCache,
  resolveManagedRoot,
  withRepositoryLease,
} from '@neottia/repository-store';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { ShardState } from './backend/types.js';
import { memoryCacheSpecification } from './index-sqlite.js';
import {
  MemoryConflictError,
  MemoryError,
  MemoryStore,
  MEMORY_TOOLS,
  createUlid,
  loadMemoryConfig,
  memoryToolJsonSchema,
  type MemoryConfig,
  type StoreMemoryInput,
} from './index.js';

/**
 * Adapted from the harnessctl-v2 memory test suite (v1 semantics on the new
 * filesystem + SQLite architecture). Integration-style tests run in temp
 * folders only; the repository and workspace folders stay immutable.
 */

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-memory-'));
  tempDirs.push(cwd);
  const path = join(cwd, '.neottia', 'config.yml');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, stringify({ version: 1, skills: { memory: { enabled: true } } }, { lineWidth: 0 }), 'utf8');
  return cwd;
}

function disabledFixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-memory-disabled-'));
  tempDirs.push(cwd);
  return cwd;
}

function fact(summary: string): StoreMemoryInput {
  return {
    memory_type: 'semantic',
    record_type: 'fact',
    summary,
    source: { kind: 'user-confirmed', ref: null, revision: null },
    created_by: 'test-user',
    confidence: 'confirmed',
  };
}

function storeFor(cwd: string, overrides: Partial<MemoryConfig> = {}): MemoryStore {
  // env: {} keeps ambient NEOTTIA_* variables out of assertions.
  return MemoryStore.fromConfig(loadMemoryConfig(cwd, { env: {}, ...overrides }), cwd);
}

async function expectImportRejectionWithoutMutation(
  store: MemoryStore,
  content: string,
  message: RegExp,
): Promise<void> {
  const before = await store.export();
  const preview = await store.import(content, true);
  expect(preview).toMatchObject({ valid: false, records: 0, tombstones: 0 });
  expect(preview.errors[0]).toMatch(message);
  expect(await store.export()).toBe(before);
  await expect(store.import(content)).rejects.toThrow(message);
  expect(await store.export()).toBe(before);
}

describe('memory store (filesystem + SQLite index)', () => {
  it('rejects disabled operations before touching memory or cache state', async () => {
    const cwd = disabledFixture();
    await expect(storeFor(cwd).store(fact('Blocked memory write.'))).rejects.toThrow(
      /skills\.memory\.enabled=true.*disabled/u,
    );
    await expect(storeFor(cwd).list()).rejects.toThrow(/skills\.memory\.enabled=true.*disabled/u);
    await expect(storeFor(cwd).search({ query: 'blocked' })).rejects.toThrow(/skills\.memory\.enabled=true.*disabled/u);
    await expect(storeFor(cwd).export()).rejects.toThrow(/skills\.memory\.enabled=true.*disabled/u);
    expect(await storeFor(cwd).validate()).toEqual(
      expect.objectContaining({
        valid: false,
        errors: [expect.stringMatching(/skills\.memory\.enabled=true.*disabled/u)],
      }),
    );
    expect(await storeFor(cwd).import('', true)).toEqual(
      expect.objectContaining({
        valid: false,
        errors: [expect.stringMatching(/skills\.memory\.enabled=true.*disabled/u)],
      }),
    );
    expect(existsSync(join(cwd, '.neottia', 'memory'))).toBe(false);
  });

  it('stores canonical records, retrieves by ID, and verifies the cache', async () => {
    const store = storeFor(fixture());
    const stored = await store.store(fact('Project uses immutable YAML memory records.'));
    expect(stored.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await store.get(stored.id)).toEqual(stored);
    expect(await store.list()).toEqual([stored]);
    expect(await store.validate()).toMatchObject({
      valid: true,
      records: 1,
      tombstones: 0,
      cache: { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' },
    });
  });

  it('rejects invalid type pairs, unverified sources, and secrets before mutation', async () => {
    const store = storeFor(fixture());
    await expect(store.store({ ...fact('Bad pair'), record_type: 'lesson' })).rejects.toThrow(MemoryError);
    await expect(store.store({ ...fact('Unverified'), confidence: 'verified' })).rejects.toThrow(MemoryError);
    await expect(store.store(fact('token=ghp_012345678901234567890123456789'))).rejects.toThrow(/secret/i);
    expect(await store.list()).toHaveLength(0);
  });

  it('rejects blank summaries and deletion reasons without corrupting state', async () => {
    const store = storeFor(fixture());
    await expect(store.store(fact('   '))).rejects.toThrow(/must not be blank/u);
    const record = await store.store(fact('Readable summary'));
    await expect(
      store.delete(record.id, ' \t ', { kind: 'user-confirmed', ref: null, revision: null }, 'test-user'),
    ).rejects.toThrow(/must not be blank/u);
    expect(await store.list()).toEqual([record]);
  });

  it('enforces compact mutation boundaries using Unicode characters', async () => {
    const store = storeFor(fixture());
    const boundaryDetails = [...Array.from({ length: 11 }, () => 'x'), 'x'.repeat(1978)].join('\n');
    const accepted = await store.store({ ...fact('🙂'.repeat(240)), details: boundaryDetails });
    expect(accepted.summary).toBe('🙂'.repeat(240));
    expect(Array.from(accepted.details ?? '')).toHaveLength(2000);
    expect(accepted.details?.split('\n')).toHaveLength(12);

    await expect(store.store(fact('🙂'.repeat(241)))).rejects.toThrow(
      /memory_store: summary has 241 Unicode characters; limit is 240/u,
    );
    await expect(store.supersede(accepted.id, { ...fact('replacement'), details: 'd'.repeat(2001) })).rejects.toThrow(
      /memory_supersede: details has 2001 Unicode characters; limit is 2000/u,
    );
    await expect(
      store.supersede(accepted.id, {
        ...fact('replacement'),
        details: Array.from({ length: 13 }, () => 'non-empty').join('\n\n'),
      }),
    ).rejects.toThrow(/memory_supersede: details has 13 non-empty lines; limit is 12/u);
    expect(await store.list({ include_superseded: true })).toEqual([accepted]);
  });

  it('supersedes and tombstones without overwriting history', async () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const first = await store.store(fact('Old fact'));
    const second = await store.supersede(first.id, fact('Corrected fact'));
    expect(await store.list()).toEqual([second]);
    expect(await store.list({ include_superseded: true })).toHaveLength(2);
    await expect(store.search({ query: 'Old fact' })).resolves.toEqual([]);
    const configured = storeFor(cwd, { retrieval: { include_superseded: true } });
    await expect(configured.search({ query: 'Old fact' })).resolves.toEqual([first]);
    await expect(store.supersede(first.id, fact('Competing correction'))).rejects.toThrow(MemoryConflictError);
    const tombstone = await store.delete(
      second.id,
      'No longer applicable',
      { kind: 'user-confirmed', ref: null, revision: null },
      'test-user',
    );
    expect(await store.get(tombstone.id)).toEqual(tombstone);
    expect(await store.list()).toHaveLength(0);
  });

  it('searches through the SQLite index with BM25 ranking and topic filters', async () => {
    const store = storeFor(fixture());
    const alpha = await store.store({ ...fact('Alpha architecture decision'), topic: 'architecture' });
    await store.store({ ...fact('Beta test convention'), topic: 'testing' });
    await expect(store.search({ query: 'Alpha', topic: 'architecture' })).resolves.toEqual([alpha]);
    await expect(store.search({ query: 'missing' })).resolves.toHaveLength(0);
    await expect(store.search({ query: 'convention', limit: 1 })).resolves.toHaveLength(1);
  });

  it('rebuilds missing or malformed SQLite bytes without losing canonical records', async () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const stored = await store.store(fact('Portable cache migration fact'));
    const cachePath = join(cwd, '.neottia', 'memory', 'index.db');
    writeFileSync(cachePath, Buffer.from('SQLite format 3\0legacy cache bytes'));

    await expect(store.search({ query: 'portable migration' })).resolves.toEqual([stored]);
    expect(await store.validate()).toMatchObject({ valid: true, records: 1 });
  });

  it('verifies a valid cache projection whose aggregate searchable text exceeds 16 MiB', async () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const seed = await store.store(fact('Aggregate projection seed'));
    const folder = join(cwd, '.neottia', 'memory', 'facts');
    const details = 'aggregate '.repeat(1_200);
    for (let index = 0; index < 1_500; index += 1) {
      const entropy = new Uint8Array(10);
      new DataView(entropy.buffer).setUint32(6, index + 1);
      const record = { ...seed, id: createUlid(1_700_000_000_000, () => entropy), details };
      writeFileSync(join(folder, `${record.id}.yaml`), stringify(record, { lineWidth: 0 }), 'utf8');
    }
    rmSync(join(cwd, '.neottia', 'memory', 'index.db'), { force: true });
    await expect(store.search({ query: 'aggregate', limit: 5 })).resolves.toBeDefined();
    await expect(store.validate()).resolves.toMatchObject({ valid: true, records: 1_501 });
  }, 30_000);

  it.each(['', '-wal', '-shm'] as const)(
    'preserves canonical YAML and a substituted Memory cache%s artifact',
    async (suffix) => {
      const cwd = fixture();
      const store = storeFor(cwd);
      const record = await store.store(fact(`Memory cache substitution ${suffix || 'database'}`));
      const canonical = join(cwd, '.neottia', 'memory', 'facts', `${record.id}.yaml`);
      const canonicalBytes = readFileSync(canonical);
      const root = await resolveManagedRoot({
        authorityRoot: cwd,
        managedPath: '.neottia/memory',
        limits: DEFAULT_STORE_LIMITS,
      });
      const state: ShardState = {
        records: [record],
        tombstones: [],
        activeIds: new Set([record.id]),
        contentHash: `substitution-${suffix}`,
      };
      await withRepositoryLease(root, async (lease) => {
        const cache = await rebuildDisposableSqliteCache(root, lease, memoryCacheSpecification(root, state));
        const artifact = join(cwd, '.neottia', 'memory', `index.db${suffix}`);
        expect(existsSync(artifact)).toBe(true);
        rmSync(artifact);
        writeFileSync(artifact, 'operator replacement');
        await expect(cache.database.prepare('SELECT 1')).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
        await expect(cache.close()).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
        expect(readFileSync(artifact, 'utf8')).toBe('operator replacement');
      });
      expect(readFileSync(canonical)).toEqual(canonicalBytes);
    },
  );

  it('rejects foreign namespaces and secrets before import mutation', async () => {
    const source = storeFor(fixture(), { namespace: { organization_id: 'source-org' } });
    const destination = storeFor(fixture());
    const stored = await source.store(fact('Portable fact'));
    const foreign = await destination.import(await source.export(), true);
    expect(foreign.valid).toBe(false);
    expect(foreign.errors[0]).toMatch(/scope|namespace/u);
    await expect(destination.import(await source.export())).rejects.toThrow(/scope|namespace/u);
    expect(await destination.list()).toEqual([]);

    const secret = { ...stored, organization_id: 'local', summary: 'token=ghp_012345678901234567890123456789' };
    const secretResult = await destination.import(`${JSON.stringify(secret)}\n`, true);
    expect(secretResult.valid).toBe(false);
    expect(secretResult.errors[0]).toMatch(/secret/u);
    await expect(destination.import(`${JSON.stringify(secret)}\n`)).rejects.toThrow(/secret/u);
    expect(await destination.list()).toEqual([]);
  });

  it('rejects overflow ULIDs on import without mutation', async () => {
    expect.assertions(5);
    const source = storeFor(fixture());
    const destination = storeFor(fixture());
    const record = await source.store(fact('Strict import identity'));
    const overflow = { ...record, id: '80000000000000000000000000' };

    await expectImportRejectionWithoutMutation(destination, `${JSON.stringify(overflow)}\n`, /Invalid memory record/u);
  });

  it('rejects conflicting lifecycle retirements before preview or persistence', async () => {
    expect.assertions(15);
    const duplicateStore = storeFor(fixture());
    const duplicateTarget = await duplicateStore.store(fact('Duplicate retirement target'));
    const replacement = (id: string, summary: string) => ({
      ...duplicateTarget,
      id,
      summary,
      created_at: new Date(Date.parse(duplicateTarget.created_at) + 1).toISOString(),
      supersedes: [duplicateTarget.id],
    });
    const firstReplacement = replacement('01ARZ3NDEKTSV4RRFFQ69G5FAW', 'First imported replacement');
    const secondReplacement = replacement('01ARZ3NDEKTSV4RRFFQ69G5FAX', 'Second imported replacement');
    await expectImportRejectionWithoutMutation(
      duplicateStore,
      `${JSON.stringify(firstReplacement)}\n${JSON.stringify(secondReplacement)}\n`,
      /multiple supersession retirements/u,
    );

    const mixedStore = storeFor(fixture());
    const mixedTarget = await mixedStore.store(fact('Mixed retirement target'));
    const mixedReplacement = { ...firstReplacement, supersedes: [mixedTarget.id] };
    const tombstone = {
      schema_version: 1,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
      organization_id: mixedTarget.organization_id,
      project_id: mixedTarget.project_id,
      target_id: mixedTarget.id,
      reason: 'Imported retirement',
      source: mixedTarget.source,
      created_at: new Date(Date.parse(mixedTarget.created_at) + 2).toISOString(),
      created_by: 'test-user',
    };
    await expectImportRejectionWithoutMutation(
      mixedStore,
      `${JSON.stringify(mixedReplacement)}\n${JSON.stringify(tombstone)}\n`,
      /both superseded and tombstoned/u,
    );

    const inactiveStore = storeFor(fixture());
    const inactiveTarget = await inactiveStore.store(fact('Already inactive target'));
    await inactiveStore.supersede(inactiveTarget.id, fact('Canonical replacement'));
    const lateReplacement = { ...secondReplacement, supersedes: [inactiveTarget.id] };
    await expectImportRejectionWithoutMutation(
      inactiveStore,
      `${JSON.stringify(lateReplacement)}\n`,
      /already inactive in canonical state/u,
    );
  });

  it('rejects supersession cycles before preview or persistence', async () => {
    const source = storeFor(fixture());
    const destination = storeFor(fixture());
    const first = await source.store(fact('Cycle first'));
    const second = await source.store(fact('Cycle second'));
    const firstCycle = { ...first, supersedes: [second.id] };
    const secondCycle = { ...second, supersedes: [first.id] };
    const content = `${JSON.stringify(firstCycle)}\n${JSON.stringify(secondCycle)}\n`;

    const preview = await destination.import(content, true);
    expect(preview.valid).toBe(false);
    expect(preview.errors[0]).toMatch(/Cyclic supersession/u);
    await expect(destination.import(content)).rejects.toThrow(/Cyclic supersession/u);
    expect(await destination.list()).toEqual([]);
  });

  it('preflights resulting filesystem limits before publishing an import batch', async () => {
    const source = storeFor(fixture());
    const destinationCwd = fixture();
    const destination = storeFor(destinationCwd, { security: { limits: { max_files: 1 } } });
    await source.store(fact('First limited record'));
    const exported = await source.export();
    const second = await source.store(fact('Second limited record'));
    const batch = `${exported}${JSON.stringify(second)}\n`;
    await expect(destination.import(batch)).rejects.toThrow(/limit/u);
    expect(await destination.list()).toEqual([]);

    const one = await destination.store(fact('Byte boundary record'));
    const path = join(destinationCwd, '.neottia', 'memory', 'facts', `${one.id}.yaml`);
    const bytes = readFileSync(path).byteLength;
    const byteLimited = storeFor(destinationCwd, { security: { limits: { max_total_bytes: bytes } } });
    await expect(byteLimited.store(fact('Would exceed bytes'))).rejects.toThrow(/byte limit/u);
    expect(await byteLimited.list()).toEqual([one]);
  });

  it('does not count disposable SQLite bytes against canonical file limits', async () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    await store.store(fact('First canonical record'));
    const database = new DatabaseSync(join(cwd, '.neottia', 'memory', 'index.db'));
    database.exec('CREATE TABLE cache_padding (value BLOB NOT NULL);');
    database.prepare('INSERT INTO cache_padding (value) VALUES (?)').run(Buffer.alloc(1_000_000));
    database.close();
    const bounded = storeFor(cwd, { security: { limits: { max_total_bytes: 100_000 } } });

    await expect(bounded.store(fact('Second canonical record'))).resolves.toMatchObject({
      summary: 'Second canonical record',
    });
    await expect(bounded.list()).resolves.toHaveLength(2);
  });

  it('rejects symlinked roots and SQLite cache artifacts', async () => {
    const cwd = fixture();
    const target = mkdtempSync(join(tmpdir(), 'neottia-memory-target-'));
    tempDirs.push(target);
    const linkedRoot = join(cwd, 'linked-memory');
    symlinkSync(target, linkedRoot, 'dir');
    expect(() => storeFor(cwd, { root: linkedRoot })).toThrow(/Unsafe memory root/u);

    const cacheCwd = fixture();
    const store = storeFor(cacheCwd);
    await store.store(fact('Cache artifact safety'));
    const actualCachePath = join(cacheCwd, '.neottia', 'memory', 'index.db');
    const cacheTarget = join(cacheCwd, 'cache-target.db');
    writeFileSync(cacheTarget, 'not-a-cache');
    rmSync(actualCachePath, { force: true });
    symlinkSync(cacheTarget, actualCachePath);
    await expect(store.search({ query: 'artifact' })).rejects.toThrow(/cache artifact|managed memory path/u);

    rmSync(actualCachePath, { force: true });
    symlinkSync(join(cacheCwd, 'missing-cache.db'), actualCachePath);
    await expect(store.search({ query: 'artifact' })).rejects.toThrow(/cache artifact|managed memory path/u);
  });

  it('exports portable JSONL and validates imports without mutation in preview, then synchronizes the cache', async () => {
    const source = storeFor(fixture());
    const destination = storeFor(fixture());
    const stored = await source.store(fact('Portable fact'));
    const exported = await source.export();
    expect(exported).toContain(stored.id);
    expect(await destination.import(exported, true)).toMatchObject({ valid: true, records: 1 });
    expect(await destination.list()).toHaveLength(0);
    expect(await destination.import(exported)).toMatchObject({ valid: true, records: 1 });
    expect(await destination.list()).toHaveLength(1);
    await expect(destination.import(exported)).rejects.toThrow(MemoryConflictError);
    expect(await destination.validate()).toMatchObject({
      valid: true,
      cache: { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' },
    });
  });

  it('synchronizes imported records under stale_policy fail', async () => {
    const source = storeFor(fixture());
    const destination = storeFor(fixture(), { cache: { max_age_ms: 300_000, stale_policy: 'fail' } });
    const stored = await source.store(fact('Imported cache synchronization'));
    await expect(destination.import(await source.export())).resolves.toMatchObject({ valid: true, records: 1 });
    expect(await destination.list()).toEqual([stored]);
    await expect(destination.search({ query: 'synchronization' })).resolves.toEqual([stored]);
  });

  it('returns identical compactness diagnostics for preview and mutating import', async () => {
    const source = storeFor(fixture());
    const destination = storeFor(fixture());
    const first = await source.store(fact('Compact import candidate'));
    const second = { ...first, id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', summary: 'x'.repeat(241) };
    const content = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;

    const preview = await destination.import(content, true);
    expect(preview).toMatchObject({ valid: false, records: 0, tombstones: 0 });
    expect(preview.errors[0]).toMatch(
      /memory_import line 2 record 01ARZ3NDEKTSV4RRFFQ69G5FAW: summary has 241 Unicode characters; limit is 240/u,
    );
    await expect(destination.import(content)).rejects.toThrow(preview.errors[0]);
    expect(await destination.list()).toEqual([]);
  });

  it('loads, validates, retrieves, searches, and exports canonical records at schema limits', async () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const seed = await store.store(fact('Seed'));
    const path = join(cwd, '.neottia', 'memory', 'facts', `${seed.id}.yaml`);
    const legacy = { ...seed, summary: 's'.repeat(1000), details: 'd'.repeat(12_000) };
    writeFileSync(path, stringify(legacy, { lineWidth: 0 }), 'utf8');

    expect(await store.validate()).toMatchObject({ valid: true, records: 1 });
    expect(await store.get(seed.id)).toEqual(legacy);
    await expect(store.search({ query: 's'.repeat(100), max_chars: 100_000 })).resolves.toEqual([legacy]);
    const exported = await store.export();
    expect(exported).toContain('s'.repeat(1000));

    const destination = storeFor(fixture());
    const preview = await destination.import(exported, true);
    expect(preview.valid).toBe(false);
    expect(preview.errors[0]).toMatch(/summary has 1000 Unicode characters; limit is 240/u);
    await expect(destination.import(exported)).rejects.toThrow(preview.errors[0]);
    expect(await destination.list()).toEqual([]);
  });

  it('rejects duplicate YAML keys in manually added records', async () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const record = await store.store(fact('Valid first'));
    const path = join(cwd, '.neottia', 'memory', 'facts', `${record.id}.yaml`);
    writeFileSync(path, `${stringify(record)}summary: duplicate\n`, 'utf8');
    expect(await store.validate()).toMatchObject({ valid: false });
    expect(readFileSync(path, 'utf8')).toContain('duplicate');
  });

  it('rejects canonical files whose filename ID differs from the document ID', async () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const record = await store.store(fact('Filename identity'));
    const originalPath = join(cwd, '.neottia', 'memory', 'facts', `${record.id}.yaml`);
    const wrongPath = join(cwd, '.neottia', 'memory', 'facts', '01ARZ3NDEKTSV4RRFFQ69G5FAV.yaml');
    writeFileSync(wrongPath, readFileSync(originalPath));
    expect((await store.validate()).valid).toBe(false);
    await expect(store.list()).rejects.toThrow(/filename does not match document ID/u);
  });

  it('returns verified rebuild evidence only after validation repairs the cache', async () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    await store.store(fact('Cache rebuild evidence'));
    const cachePath = join(cwd, '.neottia', 'memory', 'index.db');
    writeFileSync(cachePath, 'corrupt-cache');

    expect((await store.validate()).cache).toEqual({
      outcome: 'rebuilt',
      evidence: 'canonical_snapshot_rebuild_verified',
    });
    expect((await store.validate()).cache).toEqual({
      outcome: 'checked',
      evidence: 'canonical_snapshot_match_verified',
    });
  });

  it('does not repair a corrupt cache while canonical validation is invalid', async () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const stored = await store.store(fact('Initially valid'));
    const cachePath = join(cwd, '.neottia', 'memory', 'index.db');
    const memoryPath = join(cwd, '.neottia', 'memory', 'facts', `${stored.id}.yaml`);
    writeFileSync(cachePath, 'corrupt-cache');
    writeFileSync(memoryPath, 'summary: [\n');

    expect(await store.validate()).toMatchObject({
      valid: false,
      records: 0,
      tombstones: 0,
      cache: { outcome: 'skipped', evidence: 'memory_validation_failed' },
    });
    expect(readFileSync(cachePath, 'utf8')).toBe('corrupt-cache');
  });

  it('shares the filesystem lock across ignored namespace scopes', async () => {
    const cwd = fixture();
    const config = loadMemoryConfig(cwd, { namespace: { scope: 'feat/memory-core' } });
    const store = MemoryStore.fromConfig(config, cwd);
    await store.store(fact('Scoped fact'));
    expect(await store.list()).toHaveLength(1);
  });

  it('honors cache.stale_policy fail and the prompt host hook', async () => {
    const cwd = fixture();
    const failStore = storeFor(cwd, { cache: { max_age_ms: 0, stale_policy: 'fail' } });
    await failStore.store(fact('Fail policy fact'));
    await expect(failStore.search({ query: 'fact' })).rejects.toThrow(/stale.*fail/u);

    let prompted = false;
    const declined = new MemoryStore({
      config: loadMemoryConfig(cwd, { env: {}, cache: { max_age_ms: 0, stale_policy: 'prompt' } }),
      cwd,
      onStaleCache: () => {
        prompted = true;
        return false;
      },
    });
    await declined.store(fact('Prompt declined fact'));
    await expect(declined.search({ query: 'declined' })).rejects.toThrow(/rebuild declined/u);
    expect(prompted).toBe(true);

    const accepted = new MemoryStore({
      config: loadMemoryConfig(cwd, { env: {}, cache: { max_age_ms: 0, stale_policy: 'prompt' } }),
      cwd,
      onStaleCache: () => true,
    });
    await accepted.store(fact('Prompt accepted fact'));
    await expect(accepted.search({ query: 'accepted' })).resolves.toHaveLength(1);
  });

  it('preserves a primary cache error when cleanup also detects an unsafe artifact', async () => {
    const cwd = fixture();
    const seed = storeFor(cwd);
    await seed.store(fact('Primary cache failure'));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
    const cachePath = join(cwd, '.neottia', 'memory', 'index.db');
    const outside = join(cwd, 'outside.db');
    writeFileSync(outside, 'outside remains unchanged');
    const store = new MemoryStore({
      config: loadMemoryConfig(cwd, { env: {}, cache: { max_age_ms: 0, stale_policy: 'prompt' } }),
      cwd,
      onStaleCache: () => {
        rmSync(cachePath);
        symlinkSync(outside, cachePath);
        throw new Error('primary cache policy failure');
      },
    });

    await expect(store.search({ query: 'Primary' })).rejects.toThrow('primary cache policy failure');
    expect(readFileSync(outside, 'utf8')).toBe('outside remains unchanged');
  });

  it('passes interactive stale-cache decisions through the tool context', async () => {
    const cwd = fixture();
    let prompted = false;
    const context = {
      cwd,
      interactive: true,
      configOverrides: { cache: { max_age_ms: 0, stale_policy: 'prompt' as const } },
      onStaleCache: () => {
        prompted = true;
        return false;
      },
    };
    const { findMemoryTool } = await import('./tools.js');
    await findMemoryTool('memory_store')?.run(context, fact('Tool prompt'));
    await expect(findMemoryTool('memory_search')?.run(context, { query: 'Tool prompt' })).rejects.toThrow(
      /rebuild declined/u,
    );
    expect(prompted).toBe(true);
  });

  it('constructs a postgres-backed store (connects lazily)', () => {
    const cwd = fixture();
    expect(() => storeFor(cwd, { backend: 'postgres' })).not.toThrow();
  });

  it('validates tool inputs at runtime before reaching the store', async () => {
    const cwd = fixture();
    const context = { cwd, interactive: true };
    const { findMemoryTool } = await import('./tools.js');
    const getTool = findMemoryTool('memory_get');
    await expect(getTool?.run(context, { id: 'not-a-ulid' })).rejects.toThrow(/memory_get input/i);
    const storeTool = findMemoryTool('memory_store');
    await expect(storeTool?.run(context, { ...fact('Valid'), confidence: 'bogus' })).rejects.toThrow(
      /memory_store input/i,
    );
    await expect(storeTool?.run(context, { ...fact('x'.repeat(241)) })).rejects.toThrow(/memory_store input/i);
    await expect(storeTool?.run(context, { ...fact('   ') })).rejects.toThrow(/memory_store input/i);
    await expect(storeTool?.run(context, { ...fact('😀'.repeat(240)) })).resolves.toMatchObject({
      summary: '😀'.repeat(240),
    });
    expect(await storeFor(cwd).list()).toHaveLength(1);
  });

  it('publishes canonical schemas for all tool inputs and outputs', () => {
    const names = MEMORY_TOOLS.map((tool) => tool.name);
    expect(names).toEqual([
      'memory_store',
      'memory_supersede',
      'memory_delete',
      'memory_get',
      'memory_list',
      'memory_search',
      'memory_validate',
      'memory_export',
      'memory_import',
    ]);
    for (const tool of MEMORY_TOOLS) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    }

    const storeSchema = memoryToolJsonSchema('memory_store', 'input') as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(storeSchema.properties['summary']).toMatchObject({
      maxLength: 240,
      'x-neottia-length-unit': 'unicode-code-points',
    });
    expect(storeSchema.properties['details']).toMatchObject({
      anyOf: [expect.objectContaining({ 'x-neottia-max-nonempty-lines': 12 }), { type: 'null' }],
    });
    const searchSchema = memoryToolJsonSchema('memory_search', 'input') as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(searchSchema.properties['query']?.['x-neottia-max-utf8-bytes']).toBe(16 * 1024);
    const importSchema = memoryToolJsonSchema('memory_import', 'input') as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(importSchema.properties['content']?.['x-neottia-max-utf8-bytes']).toBe(64 * 1024 * 1024);
    expect(memoryToolJsonSchema('memory_export', 'output')).toMatchObject({
      type: 'string',
      'x-neottia-max-utf8-bytes': 64 * 1024 * 1024,
    });
  });

  it('keeps supersession semantics across the tools layer', async () => {
    const cwd = fixture();
    const context = { cwd, interactive: true };
    const { MEMORY_TOOLS, findMemoryTool } = await import('./tools.js');
    expect(MEMORY_TOOLS.map((tool) => tool.name)).toEqual([
      'memory_store',
      'memory_supersede',
      'memory_delete',
      'memory_get',
      'memory_list',
      'memory_search',
      'memory_validate',
      'memory_export',
      'memory_import',
    ]);
    const storeTool = findMemoryTool('memory_store');
    expect(storeTool).toBeDefined();
    const stored = (await storeTool?.run(context, { ...fact('Tool layer fact') })) as { id: string };
    expect(stored.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const listTool = findMemoryTool('memory_list');
    expect(await listTool?.run(context, {})).toHaveLength(1);
  });
});
