import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  MemoryConflictError,
  MemoryError,
  MemoryStore,
  loadMemoryConfig,
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

describe('memory store (filesystem + SQLite index)', () => {
  it('rejects disabled operations before touching memory or cache state', () => {
    const cwd = disabledFixture();
    expect(() => storeFor(cwd).store(fact('Blocked memory write.'))).toThrow(/skills\.memory\.enabled=true.*disabled/u);
    expect(() => storeFor(cwd).list()).toThrow(/skills\.memory\.enabled=true.*disabled/u);
    expect(() => storeFor(cwd).search({ query: 'blocked' })).toThrow(/skills\.memory\.enabled=true.*disabled/u);
    expect(() => storeFor(cwd).export()).toThrow(/skills\.memory\.enabled=true.*disabled/u);
    expect(storeFor(cwd).validate()).toEqual(
      expect.objectContaining({
        valid: false,
        errors: [expect.stringMatching(/skills\.memory\.enabled=true.*disabled/u)],
      }),
    );
    expect(storeFor(cwd).import('', true)).toEqual(
      expect.objectContaining({
        valid: false,
        errors: [expect.stringMatching(/skills\.memory\.enabled=true.*disabled/u)],
      }),
    );
    expect(existsSync(join(cwd, '.neottia', 'memory'))).toBe(false);
  });

  it('stores canonical records, retrieves by ID, and verifies the cache', () => {
    const store = storeFor(fixture());
    const stored = store.store(fact('Project uses immutable YAML memory records.'));
    expect(stored.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(store.get(stored.id)).toEqual(stored);
    expect(store.list()).toEqual([stored]);
    expect(store.validate()).toMatchObject({
      valid: true,
      records: 1,
      tombstones: 0,
      cache: { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' },
    });
  });

  it('rejects invalid type pairs, unverified sources, and secrets before mutation', () => {
    const store = storeFor(fixture());
    expect(() => store.store({ ...fact('Bad pair'), record_type: 'lesson' })).toThrow(MemoryError);
    expect(() => store.store({ ...fact('Unverified'), confidence: 'verified' })).toThrow(MemoryError);
    expect(() => store.store(fact('token=ghp_012345678901234567890123456789'))).toThrow(/secret/i);
    expect(store.list()).toHaveLength(0);
  });

  it('enforces compact mutation boundaries using Unicode characters', () => {
    const store = storeFor(fixture());
    const boundaryDetails = [...Array.from({ length: 11 }, () => 'x'), 'x'.repeat(1978)].join('\n');
    const accepted = store.store({ ...fact('🙂'.repeat(240)), details: boundaryDetails });
    expect(accepted.summary).toBe('🙂'.repeat(240));
    expect(Array.from(accepted.details ?? '')).toHaveLength(2000);
    expect(accepted.details?.split('\n')).toHaveLength(12);

    expect(() => store.store(fact('🙂'.repeat(241)))).toThrow(
      /memory_store: summary has 241 Unicode characters; limit is 240/u,
    );
    expect(() => store.supersede(accepted.id, { ...fact('replacement'), details: 'd'.repeat(2001) })).toThrow(
      /memory_supersede: details has 2001 Unicode characters; limit is 2000/u,
    );
    expect(() =>
      store.supersede(accepted.id, {
        ...fact('replacement'),
        details: Array.from({ length: 13 }, () => 'non-empty').join('\n\n'),
      }),
    ).toThrow(/memory_supersede: details has 13 non-empty lines; limit is 12/u);
    expect(store.list({ include_superseded: true })).toEqual([accepted]);
  });

  it('supersedes and tombstones without overwriting history', () => {
    const store = storeFor(fixture());
    const first = store.store(fact('Old fact'));
    const second = store.supersede(first.id, fact('Corrected fact'));
    expect(store.list()).toEqual([second]);
    expect(store.list({ include_superseded: true })).toHaveLength(2);
    expect(() => store.supersede(first.id, fact('Competing correction'))).toThrow(MemoryConflictError);
    const tombstone = store.delete(
      second.id,
      'No longer applicable',
      { kind: 'user-confirmed', ref: null, revision: null },
      'test-user',
    );
    expect(store.get(tombstone.id)).toEqual(tombstone);
    expect(store.list()).toHaveLength(0);
  });

  it('searches through the SQLite index with BM25 ranking and topic filters', () => {
    const store = storeFor(fixture());
    const alpha = store.store({ ...fact('Alpha architecture decision'), topic: 'architecture' });
    store.store({ ...fact('Beta test convention'), topic: 'testing' });
    expect(store.search({ query: 'Alpha', topic: 'architecture' })).toEqual([alpha]);
    expect(store.search({ query: 'missing' })).toHaveLength(0);
    expect(store.search({ query: 'convention', limit: 1 })).toHaveLength(1);
  });

  it('rebuilds missing or malformed SQLite bytes without losing canonical records', () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const stored = store.store(fact('Portable cache migration fact'));
    const cachePath = join(cwd, '.neottia', 'memory', 'index.db');
    writeFileSync(cachePath, Buffer.from('SQLite format 3\0legacy cache bytes'));

    expect(store.search({ query: 'portable migration' })).toEqual([stored]);
    expect(store.validate()).toMatchObject({ valid: true, records: 1 });
  });

  it('exports portable JSONL and validates imports without mutation in preview', () => {
    const source = storeFor(fixture());
    const destination = storeFor(fixture());
    const stored = source.store(fact('Portable fact'));
    const exported = source.export();
    expect(exported).toContain(stored.id);
    expect(destination.import(exported, true)).toMatchObject({ valid: true, records: 1 });
    expect(destination.list()).toHaveLength(0);
    expect(destination.import(exported)).toMatchObject({ valid: true, records: 1 });
    expect(destination.list()).toHaveLength(1);
    expect(() => destination.import(exported)).toThrow(MemoryConflictError);
  });

  it('returns identical compactness diagnostics for preview and mutating import', () => {
    const source = storeFor(fixture());
    const destination = storeFor(fixture());
    const first = source.store(fact('Compact import candidate'));
    const second = { ...first, id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', summary: 'x'.repeat(241) };
    const content = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;

    const preview = destination.import(content, true);
    expect(preview).toMatchObject({ valid: false, records: 0, tombstones: 0 });
    expect(preview.errors[0]).toMatch(
      /memory_import line 2 record 01ARZ3NDEKTSV4RRFFQ69G5FAW: summary has 241 Unicode characters; limit is 240/u,
    );
    expect(() => destination.import(content)).toThrow(preview.errors[0]);
    expect(destination.list()).toEqual([]);
  });

  it('loads, validates, retrieves, searches, and exports canonical records at schema limits', () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const seed = store.store(fact('Seed'));
    const path = join(cwd, '.neottia', 'memory', 'facts', `${seed.id}.yaml`);
    const legacy = { ...seed, summary: 's'.repeat(1000), details: 'd'.repeat(12_000) };
    writeFileSync(path, stringify(legacy, { lineWidth: 0 }), 'utf8');

    expect(store.validate()).toMatchObject({ valid: true, records: 1 });
    expect(store.get(seed.id)).toEqual(legacy);
    expect(store.search({ query: 's'.repeat(100), max_chars: 100_000 })).toEqual([legacy]);
    const exported = store.export();
    expect(exported).toContain('s'.repeat(1000));

    const destination = storeFor(fixture());
    const preview = destination.import(exported, true);
    expect(preview.valid).toBe(false);
    expect(preview.errors[0]).toMatch(/summary has 1000 Unicode characters; limit is 240/u);
    expect(() => destination.import(exported)).toThrow(preview.errors[0]);
    expect(destination.list()).toEqual([]);
  });

  it('rejects duplicate YAML keys in manually added records', () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const record = store.store(fact('Valid first'));
    const path = join(cwd, '.neottia', 'memory', 'facts', `${record.id}.yaml`);
    writeFileSync(path, `${stringify(record)}summary: duplicate\n`, 'utf8');
    expect(store.validate()).toMatchObject({ valid: false });
    expect(readFileSync(path, 'utf8')).toContain('duplicate');
  });

  it('returns verified rebuild evidence only after validation repairs the cache', () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    store.store(fact('Cache rebuild evidence'));
    const cachePath = join(cwd, '.neottia', 'memory', 'index.db');
    writeFileSync(cachePath, 'corrupt-cache');

    expect(store.validate().cache).toEqual({ outcome: 'rebuilt', evidence: 'canonical_snapshot_rebuild_verified' });
    expect(store.validate().cache).toEqual({ outcome: 'checked', evidence: 'canonical_snapshot_match_verified' });
  });

  it('does not repair a corrupt cache while canonical validation is invalid', () => {
    const cwd = fixture();
    const store = storeFor(cwd);
    const stored = store.store(fact('Initially valid'));
    const cachePath = join(cwd, '.neottia', 'memory', 'index.db');
    const memoryPath = join(cwd, '.neottia', 'memory', 'facts', `${stored.id}.yaml`);
    writeFileSync(cachePath, 'corrupt-cache');
    writeFileSync(memoryPath, 'summary: [\n');

    expect(store.validate()).toMatchObject({
      valid: false,
      records: 0,
      tombstones: 0,
      cache: { outcome: 'skipped', evidence: 'memory_validation_failed' },
    });
    expect(readFileSync(cachePath, 'utf8')).toBe('corrupt-cache');
  });

  it('honors the configured namespace scope in the lock identity', () => {
    const cwd = fixture();
    const config = loadMemoryConfig(cwd, { namespace: { scope: 'feat/memory-core' } });
    const store = MemoryStore.fromConfig(config, cwd);
    expect(store.scopeKey).toBe('local--project--feat/memory-core');
    store.store(fact('Scoped fact'));
    expect(store.list()).toHaveLength(1);
  });

  it('rejects the unimplemented postgres backend with a pointer to the follow-up', () => {
    const cwd = fixture();
    expect(() => storeFor(cwd, { backend: 'postgres' })).toThrow(/not implemented.*neottia#6/u);
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
    expect(storeFor(cwd).list()).toHaveLength(0);
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
