import { createSqliteAdapter, type DriverDatabase } from './adapter.js';

/** Node built-in SQLite adapter, imported only when selected. */
export const nodeSqliteAdapter = createSqliteAdapter('node', async (path, readOnly) => {
  const sqlite = await import('node:sqlite');
  return new sqlite.DatabaseSync(path, { readOnly }) as unknown as DriverDatabase;
});
