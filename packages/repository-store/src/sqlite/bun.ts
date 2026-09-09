import { createSqliteAdapter, type DriverDatabase } from './adapter.js';

interface BunSqliteModule {
  readonly Database: new (path: string, options?: { readonly: boolean; create: boolean }) => DriverDatabase;
}

/** Bun built-in SQLite adapter, imported only when selected. */
export const bunSqliteAdapter = createSqliteAdapter('bun', async (path, readOnly) => {
  // A non-literal specifier keeps Node declaration builds independent of Bun types.
  const moduleName = 'bun:sqlite';
  const sqlite = (await import(moduleName)) as BunSqliteModule;
  return new sqlite.Database(path, { readonly: readOnly, create: !readOnly });
});
