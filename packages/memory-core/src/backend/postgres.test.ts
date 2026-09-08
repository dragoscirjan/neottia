import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryConflictError, MemoryError, MemoryStore, PostgresBackend, loadMemoryConfig } from '../index.js';
import type { StoreMemoryInput } from '../store.js';

/**
 * Integration test for the Postgres backend (issue #6), executed against the
 * Docker PostgreSQL from dependencies/postgres (pg_textsearch BM25 included).
 *
 * Gated by NEOTTIA_TEST_PG=1 so `mise run validate` never requires Docker.
 * The container lifecycle: started here when not healthy, left running for
 * faster re-runs (`docker compose down -v` in dependencies/postgres wipes).
 */

const enabled = process.env.NEOTTIA_TEST_PG === '1';
const dependenciesDir = resolve(__dirname, '..', '..', '..', '..', 'dependencies', 'postgres');
const connectionString = 'postgres://neottia:neottia@localhost:5433/neottia';

function compose(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('docker', ['compose', ...args], { cwd: dependenciesDir, encoding: 'utf8' });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function containerHealthy(): boolean {
  return compose(['ps', '--format', 'json']).stdout.includes('"Health":"healthy"');
}

function fact(summary: string): StoreMemoryInput {
  return {
    memory_type: 'semantic',
    record_type: 'fact',
    summary,
    source: { kind: 'user-confirmed', ref: null, revision: null },
    created_by: 'pg-test',
    confidence: 'confirmed',
  };
}

function pgStore(namespace: Partial<{ organization_id: string; project_id: string; scope: string }> = {}): MemoryStore {
  return MemoryStore.fromConfig(
    loadMemoryConfig(process.cwd(), {
      env: {},
      enabled: true,
      backend: 'postgres',
      namespace: {
        organization_id: 'pgtest',
        project_id: 'shard',
        default_topic: 'general',
        scope: 'global',
        ...namespace,
      },
      provider: { db: { pg: { ssl: false, port: 5433 } } },
    }),
    process.cwd(),
  );
}

beforeAll(async () => {
  if (!enabled) return;
  process.env.NEOTTIA_MEMORY_DB_PG_USER = 'neottia';
  process.env.NEOTTIA_MEMORY_DB_PG_PASSWORD = 'neottia';
  if (!containerHealthy()) {
    const up = compose(['up', '-d', '--build']);
    if (up.status !== 0) throw new Error(`Cannot start the test PostgreSQL:\n${up.stderr}`);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (containerHealthy()) return;
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 1_000));
  }
  throw new Error('The test PostgreSQL did not become healthy in time.');
}, 600_000);

afterAll(async () => {
  // Container intentionally left running for faster subsequent runs.
});

/** Deletes every row (records + tombstones) of the given shard, directly. */
async function wipeShard(namespace: { organization_id: string; project_id: string; scope: string }): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`DELETE FROM memory_records WHERE organization_id = $1 AND project_id = $2`, [
      namespace.organization_id,
      namespace.project_id,
    ]);
    await client.query(`DELETE FROM memory_tombstones`);
  } catch (error: unknown) {
    // 42P01 (undefined_table): the backend has not created its schema yet.
    if ((error as { code?: string }).code !== '42P01') throw error;
  } finally {
    await client.end();
  }
}

describe.skipIf(!enabled)('postgres backend (docker pg_textsearch)', () => {
  const shard = { organization_id: 'pgtest', project_id: 'shard', scope: 'global' };
  let store: MemoryStore;

  beforeEach(async () => {
    store = pgStore();
    await wipeShard(shard);
  });

  it('stores canonical records in PostgreSQL and retrieves them by ID', async () => {
    const stored = await store.store(fact('Postgres keeps the memory shard'));
    expect(stored.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await store.get(stored.id)).toEqual(stored);
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.topic).toBe('general');
  });

  it('searches with BM25 relevance through pg_textsearch', async () => {
    const alpha = await store.store(fact('The deployment pipeline uses PAPYRUS images'));
    await store.store(fact('The testing convention prefers WATERFALL fixtures'));
    const hits = await store.search({ query: 'PAPYRUS deployment' });
    expect(hits[0]?.id).toBe(alpha.id);
    expect(await store.search({ query: 'nonexistent' })).toHaveLength(0);
  });

  it('supersedes and tombstones without overwriting history', async () => {
    const first = await store.store(fact('Old fact'));
    const second = await store.supersede(first.id, fact('Corrected fact'));
    expect(await store.list()).toEqual([second]);
    expect(await store.list({ include_superseded: true })).toHaveLength(2);
    await expect(store.supersede(first.id, fact('Competing correction'))).rejects.toThrow(MemoryConflictError);
    const tombstone = await store.delete(second.id, 'obsolete', second.source, 'pg-test');
    expect(await store.get(tombstone.id)).toEqual(tombstone);
    expect(await store.list()).toHaveLength(0);
  });

  it('enforces compactness and secret scanning before mutation', async () => {
    await expect(store.store(fact('x'.repeat(241)))).rejects.toThrow(MemoryError);
    await expect(store.store(fact('token=ghp_012345678901234567890123456789'))).rejects.toThrow(/secret/i);
    expect(await store.list()).toHaveLength(0);
  });

  it('round-trips export and import within the namespace', async () => {
    const stored = await store.store(fact('Portable pg fact'));
    const exported = await store.export();
    expect(exported).toContain(stored.id);

    // Wipe the shard directly; the JSONL payload is the only surviving copy.
    await wipeShard(shard);
    expect(await store.list()).toHaveLength(0);

    const destination = pgStore();
    expect(await destination.import(exported, true)).toMatchObject({ valid: true, records: 1 });
    expect(await destination.list()).toHaveLength(0);
    expect(await destination.import(exported)).toMatchObject({ valid: true, records: 1 });
    expect(await destination.list()).toHaveLength(1);
    await expect(destination.import(exported)).rejects.toThrow(MemoryConflictError);
  });

  it('validates integrity and reports the cache checked', async () => {
    await store.store(fact('Validate me'));
    expect(await store.validate()).toMatchObject({
      valid: true,
      records: 1,
      cache: { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' },
    });
  });

  it('serializes concurrent writers through the advisory lock', async () => {
    const [left, right] = [pgStore(), pgStore()];
    const results = await Promise.all([
      left.store(fact('Concurrent writer A')),
      right.store(fact('Concurrent writer B')),
    ]);
    await left.close();
    await right.close();
    expect(new Set(results.map((record) => record.id)).size).toBe(2);
    expect(await store.list()).toHaveLength(2);
  });

  it('exposes the backend through the store facade', () => {
    const backend = new PostgresBackend({
      config: loadMemoryConfig(process.cwd(), {
        env: {},
        enabled: true,
        backend: 'postgres',
        namespace: { organization_id: 'pgtest', project_id: 'shard', scope: 'global' },
        provider: { db: { pg: { ssl: false, port: 5433 } } },
      }),
      cwd: process.cwd(),
    });
    expect(backend).toBeInstanceOf(PostgresBackend);
  });
});
