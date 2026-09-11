import { describe, expect, it } from 'vitest';
import { ResourceLimitError } from '../errors.js';
import { wrapDatabase, type DriverDatabase } from './adapter.js';
import { nodeSqliteAdapter } from './node.js';
import { runSqliteAdapterContract } from './test-contract.js';

runSqliteAdapterContract({ describe, expect, it }, nodeSqliteAdapter);

describe('bounded SQLite cursors', () => {
  it('enforces connection SQL and get-result bounds before returning', async () => {
    let executed = 0;
    const database = wrapDatabase(
      'node',
      {
        exec: () => {
          executed += 1;
        },
        prepare: () => ({
          run: () => ({}),
          get: () => ({ id: '1234567' }),
          all: () => [],
          *iterate() {},
        }),
        close: () => undefined,
      },
      { maxSqlBytes: 10, maxStatementParameterBytes: 8, maxQueryRows: 2, maxQueryResultBytes: 8 },
    );
    await database.exec('1234567890');
    await expect(database.exec('12345678901')).rejects.toBeInstanceOf(ResourceLimitError);
    expect(executed).toBe(1);
    const statement = await database.prepare('SELECT 1');
    await expect(statement.get()).rejects.toBeInstanceOf(ResourceLimitError);
    await database.close();
  });

  it('rejects drivers without cursors instead of eagerly calling all()', async () => {
    let materialized = false;
    const database = wrapDatabase('node', {
      exec: () => undefined,
      prepare: () => ({
        run: () => ({}),
        get: () => undefined,
        all: () => {
          materialized = true;
          return [];
        },
      }),
      close: () => undefined,
    });
    const statement = await database.prepare('SELECT id FROM items');
    await expect(statement.all(undefined, { maxRows: 1, maxBytes: 10 })).rejects.toMatchObject({
      code: 'CACHE_SYNC_FAILED',
    });
    expect(materialized).toBe(false);
    await database.close();
  });

  it('stops iterating as soon as the row bound is exceeded', async () => {
    let yielded = 0;
    const statement = {
      run: () => ({}),
      get: () => undefined,
      all: () => {
        throw new Error('all() must not materialize rows when iterate() is available.');
      },
      *iterate() {
        yielded += 1;
        yield { id: 1 };
        yielded += 1;
        yield { id: 2 };
        yielded += 1;
        throw new Error('cursor was consumed past the bound');
      },
    };
    const database = wrapDatabase('node', {
      exec: () => undefined,
      prepare: () => statement,
      close: () => undefined,
    } satisfies DriverDatabase);
    const prepared = await database.prepare('SELECT id FROM items');
    await expect(prepared.all(undefined, { maxRows: 1, maxBytes: 1_000 })).rejects.toBeInstanceOf(ResourceLimitError);
    expect(yielded).toBe(2);
    await database.close();
  });
});
