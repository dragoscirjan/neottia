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

    api.it('bounds positional and named parameter bytes before driver mutation', async () => {
      const root = mkdtempSync(join(tmpdir(), `neottia-${adapter.runtime}-parameters-`));
      const path = join(root, 'parameters.db');
      const limits = {
        maxSqlBytes: 1_000,
        maxStatementParameterBytes: 8,
        maxQueryRows: 10,
        maxQueryResultBytes: 1_000,
      };
      const database = await adapter.open(path, { readOnly: false, busyTimeoutMs: 1_000, limits });
      try {
        await database.exec('CREATE TABLE items (id TEXT PRIMARY KEY, value BLOB NOT NULL);');
        const positional = await database.prepare('INSERT INTO items (id, value) VALUES (?, ?)');
        await positional.run(['é', new Uint8Array(6)]);
        let overCode: unknown;
        try {
          await positional.run(['é', new Uint8Array(7)]);
        } catch (error: unknown) {
          overCode = error instanceof Error && 'code' in error ? error.code : undefined;
        }
        api.expect(overCode).toBe('LIMIT_EXCEEDED');

        const named = await database.prepare('INSERT INTO items (id, value) VALUES ($id, $value)');
        await named.run({ $id: 'n', $value: '1234567' });
        overCode = undefined;
        try {
          await named.run({ $id: 'x', $value: '12345678' });
        } catch (error: unknown) {
          overCode = error instanceof Error && 'code' in error ? error.code : undefined;
        }
        api.expect(overCode).toBe('LIMIT_EXCEEDED');

        const byNumber = await database.prepare('SELECT id FROM items WHERE length(value) = ?');
        api.expect((await byNumber.get<{ id: string }>([6]))?.id).toBe('é');
        const byText = await database.prepare('SELECT id FROM items WHERE id = ?');
        const rows = await byText.all<{ id: string }>(['éééé'], { maxRows: 10, maxBytes: 100 });
        api.expect(rows).toEqual([]);
        overCode = undefined;
        try {
          await byText.all(['ééééx'], { maxRows: 10, maxBytes: 100 });
        } catch (error: unknown) {
          overCode = error instanceof Error && 'code' in error ? error.code : undefined;
        }
        api.expect(overCode).toBe('LIMIT_EXCEEDED');

        const count = await (await database.prepare('SELECT count(*) AS count FROM items')).get<{ count: number }>();
        api.expect(count?.count).toBe(2);
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
