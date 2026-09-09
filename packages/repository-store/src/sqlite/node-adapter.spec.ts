import { describe, expect, it } from 'vitest';
import { ResourceLimitError } from '../errors.js';
import { wrapDatabase, type DriverDatabase } from './adapter.js';
import { nodeSqliteAdapter } from './node.js';
import { runSqliteAdapterContract } from './test-contract.js';

runSqliteAdapterContract({ describe, expect, it }, nodeSqliteAdapter);

describe('bounded SQLite cursors', () => {
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
