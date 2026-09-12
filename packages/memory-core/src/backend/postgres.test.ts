import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerImportLifecycleContract } from '../import-lifecycle.spec-helper.js';
import {
  MemoryConflictError,
  MemoryError,
  MemoryStore,
  PostgresBackend,
  createUlid,
  loadMemoryConfig,
} from '../index.js';
import type { StoreMemoryInput } from '../store.js';

/**
 * Integration test for the Postgres backend (issue #6), executed against the
 * Docker PostgreSQL from dependencies/postgres (pg_textsearch BM25 included).
 *
 * Gated by NEOTTIA_TEST_PG=1 so `mise run validate` never requires Docker.
 * Each enabled run owns a unique Compose project, random host port, and
 * disposable volume; teardown removes all of those resources.
 */

const enabled = process.env.NEOTTIA_TEST_PG === '1';
const dependenciesDir = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'dependencies',
  'postgres',
);
const fixtureId = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
const composeProject = `neottia-pg-${fixtureId}`;
const defaultNamespace = { organization_id: `pgtest-${fixtureId}`, project_id: 'shard', scope: 'global' };
const credentialEnv = {
  NEOTTIA_MEMORY_DB_PG_USER: 'neottia',
  NEOTTIA_MEMORY_DB_PG_PASSWORD: 'neottia',
} as NodeJS.ProcessEnv;
let postgresPort = 0;

function compose(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('docker', ['compose', '--project-name', composeProject, ...args], {
    cwd: dependenciesDir,
    encoding: 'utf8',
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function containerHealthy(): boolean {
  return compose(['ps', '--format', 'json']).stdout.includes('"Health":"healthy"');
}

function connectionString(): string {
  return `postgres://neottia:neottia@127.0.0.1:${postgresPort}/neottia`;
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

function pgStore(
  namespace: Partial<{ organization_id: string; project_id: string; scope: string }> = {},
  limits: Partial<{ max_file_bytes: number; max_files: number; max_total_bytes: number }> = {},
): MemoryStore {
  return MemoryStore.fromConfig(
    loadMemoryConfig(process.cwd(), {
      env: credentialEnv,
      enabled: true,
      backend: 'postgres',
      namespace: {
        ...defaultNamespace,
        default_topic: 'general',
        ...namespace,
      },
      provider: { db: { pg: { ssl: false, host: '127.0.0.1', port: postgresPort } } },
      security: {
        limits: {
          max_file_bytes: 16 * 1024 * 1024,
          max_files: 10_000,
          max_total_bytes: 256 * 1024 * 1024,
          ...limits,
        },
      },
    }),
    process.cwd(),
  );
}

beforeAll(async () => {
  if (!enabled) return;
  const up = compose(['up', '-d', '--build']);
  if (up.status !== 0) throw new Error(`Cannot start the test PostgreSQL:\n${up.stderr}`);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (containerHealthy()) {
      const mapped = compose(['port', 'postgres', '5432']);
      const match = /:(\d+)\s*$/u.exec(mapped.stdout);
      if (!match) throw new Error(`Cannot discover the test PostgreSQL port: ${mapped.stderr || mapped.stdout}`);
      postgresPort = Number(match[1]);
      return;
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 1_000));
  }
  throw new Error('The test PostgreSQL did not become healthy in time.');
}, 600_000);

afterAll(() => {
  if (!enabled) return;
  const down = compose(['down', '--volumes', '--remove-orphans']);
  if (down.status !== 0) throw new Error(`Cannot tear down the test PostgreSQL:\n${down.stderr}`);
});

/** Deletes every row (records + tombstones) of the given shard, directly. */
async function wipeShard(namespace: { organization_id: string; project_id: string; scope: string }): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    await client.query(`DELETE FROM memory_records WHERE organization_id = $1 AND project_id = $2 AND scope = $3`, [
      namespace.organization_id,
      namespace.project_id,
      namespace.scope,
    ]);
    await client.query(`DELETE FROM memory_tombstones WHERE organization_id = $1 AND project_id = $2 AND scope = $3`, [
      namespace.organization_id,
      namespace.project_id,
      namespace.scope,
    ]);
  } catch (error: unknown) {
    // 42P01 (undefined_table): the backend has not created its schema yet.
    if ((error as { code?: string }).code !== '42P01') throw error;
  } finally {
    await client.end();
  }
}

describe('postgres backend bounded waits', () => {
  it('reports an actionable connection failure without Docker', async () => {
    const backend = new PostgresBackend({
      config: loadMemoryConfig(process.cwd(), {
        env: {},
        enabled: true,
        backend: 'postgres',
        provider: {
          db: {
            pg: { host: '127.0.0.1', port: 1, ssl: false, user: 'unreachable', password: 'unreachable' },
          },
        },
      }),
      cwd: process.cwd(),
    });
    try {
      await expect(backend.loadState()).rejects.toThrow(/connection failed within the 5 second wait/u);
    } finally {
      await backend.close();
    }
  }, 15_000);
});

describe.skipIf(!enabled)('postgres backend (docker pg_textsearch)', () => {
  const shard = defaultNamespace;
  const initializedContractShards = new Set<string>();
  let store: MemoryStore;

  beforeEach(async () => {
    store = pgStore();
    await wipeShard(shard);
  });

  afterEach(async () => {
    await store.close();
  });

  it('migrates legacy global rows idempotently while initializers race', async () => {
    const recordId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const tombstoneId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
    const createdAt = '2025-01-01T00:00:00.000Z';
    const source = { kind: 'user-confirmed', ref: null, revision: null };
    const document = {
      schema_version: 1,
      id: recordId,
      memory_type: 'semantic',
      record_type: 'fact',
      organization_id: defaultNamespace.organization_id,
      project_id: defaultNamespace.project_id,
      topic: 'general',
      summary: 'Legacy global record',
      details: null,
      source,
      created_at: createdAt,
      created_by: 'legacy-test',
      confidence: 'confirmed',
      status: 'active',
      supersedes: [],
      tags: [],
    };
    const tombstone = {
      schema_version: 1,
      id: tombstoneId,
      organization_id: defaultNamespace.organization_id,
      project_id: defaultNamespace.project_id,
      target_id: recordId,
      reason: 'Legacy global tombstone',
      source,
      created_at: createdAt,
      created_by: 'legacy-test',
    };
    const client = new pg.Client({ connectionString: connectionString() });
    await client.connect();
    try {
      await client.query(`
        CREATE TABLE memory_records (
          id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
          memory_type TEXT NOT NULL, record_type TEXT NOT NULL, topic TEXT NOT NULL,
          summary TEXT NOT NULL, details TEXT, created_at TIMESTAMPTZ NOT NULL,
          created_by TEXT NOT NULL, supersedes JSONB NOT NULL DEFAULT '[]',
          tags JSONB NOT NULL DEFAULT '[]', document JSONB NOT NULL
        );
        CREATE TABLE memory_tombstones (
          id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
          target_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, document JSONB NOT NULL
        );
      `);
      await client.query(
        `INSERT INTO memory_records
           (id, organization_id, project_id, memory_type, record_type, topic, summary, details,
            created_at, created_by, supersedes, tags, document)
         VALUES ($1, $2, $3, 'semantic', 'fact', 'general', 'Legacy global record', NULL,
                 $4, 'legacy-test', '[]', '[]', $5)`,
        [recordId, defaultNamespace.organization_id, defaultNamespace.project_id, createdAt, document],
      );
      await client.query(
        `INSERT INTO memory_tombstones
           (id, organization_id, project_id, target_id, created_at, document)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tombstoneId, defaultNamespace.organization_id, defaultNamespace.project_id, recordId, createdAt, tombstone],
      );
    } finally {
      await client.end();
    }

    const [left, right] = [pgStore(), pgStore()];
    try {
      const [leftRecord, rightTombstone] = await Promise.all([left.get(recordId), right.get(tombstoneId)]);
      expect(leftRecord).toMatchObject({ id: recordId });
      expect(rightTombstone).toMatchObject({ id: tombstoneId });
    } finally {
      await left.close();
      await right.close();
    }
  });

  it('uses fallback credential environment variables through backend construction', async () => {
    const fallback = pgStore({ scope: 'credential-fallback' });
    try {
      await expect(fallback.list()).resolves.toEqual([]);
    } finally {
      await fallback.close();
    }
  });

  it('isolates records by namespace scope', async () => {
    const feature = pgStore({ scope: 'feature-a' });
    const other = pgStore({ scope: 'feature-b' });
    try {
      const stored = await feature.store(fact('Scoped PostgreSQL fact'));
      expect(await other.list()).toEqual([]);
      expect(await feature.list()).toEqual([stored]);
    } finally {
      await feature.close();
      await other.close();
    }
  });

  it('allows the same imported record and tombstone IDs in different organizations and scopes', async () => {
    const record = await store.store(fact('Composite record identity'));
    const tombstone = await store.delete(record.id, 'composite tombstone identity', record.source, 'pg-test');
    const exported = await store.export();
    const scoped = pgStore({ scope: 'another-scope' });
    const organization = `${defaultNamespace.organization_id}-other`;
    const crossOrganizationPayload = `${exported
      .trim()
      .split('\n')
      .map((line) => JSON.stringify({ ...(JSON.parse(line) as object), organization_id: organization }))
      .join('\n')}\n`;
    const otherOrganization = pgStore({ organization_id: organization });
    try {
      await scoped.import(exported);
      await otherOrganization.import(crossOrganizationPayload);
      expect(await scoped.get(record.id)).toMatchObject({ id: record.id });
      expect(await scoped.get(tombstone.id)).toMatchObject({ id: tombstone.id });
      expect(await otherOrganization.get(record.id)).toMatchObject({ id: record.id });
      expect(await otherOrganization.get(tombstone.id)).toMatchObject({ id: tombstone.id });
    } finally {
      await scoped.close();
      await otherOrganization.close();
    }
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
    expect(await store.search({ query: 'PAPYRUS OR WATERFALL' })).toHaveLength(0);
    expect(await store.search({ query: 'nonexistent' })).toHaveLength(0);
  });

  it('pages past more than 50 excluded ranked rows to find an eligible record', async () => {
    for (let index = 0; index < 51; index += 1) {
      const excluded = await store.store(fact(`${'needle '.repeat(20)}excluded ${index}`));
      await store.delete(excluded.id, 'exclude ranked result', excluded.source, 'pg-test');
    }
    const eligible = await store.store(fact('needle eligible'));
    expect(await store.search({ query: 'needle', limit: 1 })).toEqual([eligible]);
  });

  it('keeps the search character budget cumulative across filtered pages', async () => {
    for (let index = 0; index < 55; index += 1) await store.store(fact(`Shared paging token ${index}`));
    const hits = await store.search({ query: 'paging token', limit: 100, max_chars: 512 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.reduce((total, record) => total + JSON.stringify(record).length, 0)).toBeLessThanOrEqual(512);
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

  it('rejects replacement documents whose identity disagrees with the path', async () => {
    const record = await store.store(fact('Path identity'));
    const backend = new PostgresBackend({
      config: loadMemoryConfig(process.cwd(), {
        env: credentialEnv,
        enabled: true,
        backend: 'postgres',
        namespace: defaultNamespace,
        provider: { db: { pg: { ssl: false, host: '127.0.0.1', port: postgresPort } } },
      }),
      cwd: process.cwd(),
    });
    try {
      await expect(
        backend.applyBatch([
          {
            path: `facts/${record.id}.yaml`,
            bytes: backend.encode({ ...record, id: createUlid() }),
            exclusive: false,
          },
        ]),
      ).rejects.toThrow(/does not match record identity/u);
    } finally {
      await backend.close();
    }
  });

  it('enforces resulting shard file-count limits without partial mutation', async () => {
    const limited = pgStore({}, { max_files: 1 });
    try {
      await limited.store(fact('First limited record'));
      await expect(limited.store(fact('Rejected second record'))).rejects.toThrow(/max_files/u);
      expect(await limited.list({ limit: 10 })).toHaveLength(1);
    } finally {
      await limited.close();
    }
  });

  it('enforces per-item and total byte limits without mutation', async () => {
    const itemLimited = pgStore({ scope: 'item-limit' }, { max_file_bytes: 64 });
    const totalLimited = pgStore({ scope: 'total-limit' }, { max_total_bytes: 2_200 });
    try {
      await expect(itemLimited.store(fact('This record exceeds a deliberately tiny item limit'))).rejects.toThrow(
        /max_file_bytes/u,
      );
      expect(await itemLimited.list()).toEqual([]);

      await totalLimited.store({ ...fact('First aggregate record'), details: 'a'.repeat(1_000) });
      await expect(
        totalLimited.store({ ...fact('Second aggregate record'), details: 'b'.repeat(1_000) }),
      ).rejects.toThrow(/max_total_bytes/u);
      expect(await totalLimited.list({ limit: 10 })).toHaveLength(1);
    } finally {
      await itemLimited.close();
      await totalLimited.close();
    }
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
    try {
      expect(await destination.import(exported, true)).toMatchObject({ valid: true, records: 1 });
      expect(await destination.list()).toHaveLength(0);
      expect(await destination.import(exported)).toMatchObject({ valid: true, records: 1 });
      expect(await destination.list()).toHaveLength(1);
      await expect(destination.import(exported)).rejects.toThrow(MemoryConflictError);
    } finally {
      await destination.close();
    }
  });

  it('validates and rebuilds a stale non-empty search cache', async () => {
    const record = await store.store(fact('Validate me'));
    const client = new pg.Client({ connectionString: connectionString() });
    await client.connect();
    try {
      await client.query(
        `UPDATE memory_records SET search_text = $1
         WHERE id = $2 AND organization_id = $3 AND project_id = $4 AND scope = $5`,
        [
          'stale text',
          record.id,
          defaultNamespace.organization_id,
          defaultNamespace.project_id,
          defaultNamespace.scope,
        ],
      );
    } finally {
      await client.end();
    }
    expect(await store.validate()).toMatchObject({
      valid: true,
      records: 1,
      cache: { outcome: 'rebuilt', evidence: 'canonical_snapshot_rebuild_verified' },
    });
    expect(await store.search({ query: 'Validate me' })).toHaveLength(1);
  });

  it('repairs stale search text before ranking', async () => {
    const record = await store.store(fact('Search repair'));
    const client = new pg.Client({ connectionString: connectionString() });
    await client.connect();
    try {
      await client.query(
        `UPDATE memory_records SET search_text = $1
         WHERE id = $2 AND organization_id = $3 AND project_id = $4 AND scope = $5`,
        [
          'stale text',
          record.id,
          defaultNamespace.organization_id,
          defaultNamespace.project_id,
          defaultNamespace.scope,
        ],
      );
    } finally {
      await client.end();
    }
    expect(await store.search({ query: 'Search repair' })).toHaveLength(1);
  });

  it('validates integrity and reports the cache checked', async () => {
    await store.store(fact('Validate me'));
    expect(await store.validate()).toMatchObject({
      valid: true,
      records: 1,
      cache: { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' },
    });
  });

  it('bounds advisory-lock waits with an actionable error', async () => {
    await store.list();
    const blocker = new pg.Client({ connectionString: connectionString() });
    await blocker.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${defaultNamespace.organization_id}:${defaultNamespace.project_id}:${defaultNamespace.scope}`,
      ]);
      await expect(store.list()).rejects.toThrow(/Timed out after 10 seconds.*advisory lock/u);
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      await blocker.end();
    }
  }, 20_000);

  it('serializes concurrent writers through the advisory lock', async () => {
    const [left, right] = [pgStore(), pgStore()];
    try {
      const results = await Promise.all([
        left.store(fact('Concurrent writer A')),
        right.store(fact('Concurrent writer B')),
      ]);
      expect(new Set(results.map((record) => record.id)).size).toBe(2);
      expect(await store.list()).toHaveLength(2);
    } finally {
      await left.close();
      await right.close();
    }
  });

  it('exposes the backend through the store facade', async () => {
    const backend = new PostgresBackend({
      config: loadMemoryConfig(process.cwd(), {
        env: credentialEnv,
        enabled: true,
        backend: 'postgres',
        namespace: defaultNamespace,
        provider: { db: { pg: { ssl: false, host: '127.0.0.1', port: postgresPort } } },
      }),
      cwd: process.cwd(),
    });
    try {
      expect(backend).toBeInstanceOf(PostgresBackend);
    } finally {
      await backend.close();
    }
  });

  registerImportLifecycleContract('PostgreSQL', async (caseId) => {
    const scope = `contract-${caseId}`;
    const namespace = { ...defaultNamespace, scope };
    if (!initializedContractShards.has(scope)) {
      await wipeShard(namespace);
      initializedContractShards.add(scope);
    }
    return pgStore({ scope });
  });
});
