import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SqliteAdapter } from './adapter.js';

interface Expectation {
  toBe(expected: unknown): unknown;
  toEqual(expected: unknown): unknown;
}

interface SuiteApi {
  describe(name: string, operation: () => void): void;
  it(name: string, operation: () => void | Promise<void>): void;
  expect(value: unknown): Expectation;
}

/** Registers the identical behavioral contract under Vitest and Bun test. */
export function runSqliteAdapterContract(api: SuiteApi, adapter: SqliteAdapter): void {
  api.describe(`${adapter.runtime} SQLite adapter`, () => {
    api.it('normalizes bindings, rows, and transactions', async () => {
      const root = mkdtempSync(join(tmpdir(), `neottia-${adapter.runtime}-sqlite-`));
      const path = join(root, 'contract.db');
      const database = await adapter.open(path, { readOnly: false, busyTimeoutMs: 1_000 });
      try {
        await database.exec('CREATE TABLE items (id TEXT PRIMARY KEY, value INTEGER NOT NULL);');
        const insert = await database.prepare('INSERT INTO items (id, value) VALUES (?, ?)');
        await insert.run(['one', 1]);
        await database.exec('BEGIN IMMEDIATE;');
        await insert.run(['two', 2]);
        await database.exec('ROLLBACK;');
        const rows = await (
          await database.prepare('SELECT id, value FROM items ORDER BY id')
        ).all<{
          id: string;
          value: number;
        }>(undefined, { maxRows: 10, maxBytes: 1_000 });
        api.expect(rows).toEqual([{ id: 'one', value: 1 }]);
      } finally {
        await database.close();
        rmSync(root, { recursive: true, force: true });
      }
    });

    api.it('normalizes write contention as retryable cache busy', async () => {
      const root = mkdtempSync(join(tmpdir(), `neottia-${adapter.runtime}-busy-`));
      const path = join(root, 'busy.db');
      const owner = await adapter.open(path, { readOnly: false, busyTimeoutMs: 10 });
      const contender = await adapter.open(path, { readOnly: false, busyTimeoutMs: 10 });
      try {
        await owner.exec('CREATE TABLE busy_test (id INTEGER PRIMARY KEY);');
        await owner.exec('BEGIN IMMEDIATE;');
        let code: unknown;
        try {
          await contender.exec('BEGIN IMMEDIATE;');
        } catch (error: unknown) {
          code = error instanceof Error && 'code' in error ? error.code : undefined;
        }
        api.expect(code).toBe('CACHE_BUSY');
        await owner.exec('ROLLBACK;');
      } finally {
        await contender.close();
        await owner.close();
        rmSync(root, { recursive: true, force: true });
      }
    });

    api.it('provides FTS5, WAL, and deterministic BM25 ordering', async () => {
      const root = mkdtempSync(join(tmpdir(), `neottia-${adapter.runtime}-fts-`));
      const path = join(root, 'fts.db');
      const database = await adapter.open(path, { readOnly: false, busyTimeoutMs: 1_000 });
      try {
        const capability = await (
          await database.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled")
        ).get<{
          enabled: number;
        }>();
        api.expect(capability?.enabled).toBe(1);
        const journal = await (await database.prepare('PRAGMA journal_mode=WAL')).get<{ journal_mode: string }>();
        api.expect(journal?.journal_mode.toLowerCase()).toBe('wal');
        await database.exec("CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED, text, tokenize='porter unicode61');");
        const insert = await database.prepare('INSERT INTO search (id, text) VALUES (?, ?)');
        await insert.run(['b', 'repository recovery']);
        await insert.run(['a', 'repository recovery']);
        const rows = await (
          await database.prepare('SELECT id FROM search WHERE search MATCH ? ORDER BY bm25(search) ASC, id ASC')
        ).all<{ id: string }>(['"repo"*'], { maxRows: 10, maxBytes: 1_000 });
        api.expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
      } finally {
        await database.close();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
}
