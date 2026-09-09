import { CacheSyncError, RepositoryStoreError, ResourceLimitError } from '../errors.js';

/** Values with portable binding semantics across Node and Bun SQLite drivers. */
export type SqliteValue = null | string | number | bigint | Uint8Array;
export type SqliteParameters = readonly SqliteValue[] | Readonly<Record<string, SqliteValue>>;

/** Normalized write result shared by built-in SQLite adapters. */
export interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

/** Bounded prepared statement contract. */
export interface SqliteStatement {
  run(parameters?: SqliteParameters): Promise<SqliteRunResult>;
  get<T>(parameters?: SqliteParameters): Promise<T | undefined>;
  all<T>(
    parameters: SqliteParameters | undefined,
    bounds: { readonly maxRows: number; readonly maxBytes: number },
  ): Promise<readonly T[]>;
}

/** Runtime-neutral asynchronous SQLite connection. */
export interface SqliteConnection {
  exec(sql: string): Promise<void>;
  prepare(sql: string): Promise<SqliteStatement>;
  close(): Promise<void>;
}

/** Runtime-specific adapter selected lazily by repository-store. */
export interface SqliteAdapter {
  readonly runtime: 'node' | 'bun';
  open(
    path: string,
    options: { readonly readOnly: boolean; readonly busyTimeoutMs: number },
  ): Promise<SqliteConnection>;
}

/** Minimal structural driver shapes needed by both built-in adapters. */
export interface DriverDatabase {
  exec(sql: string): unknown;
  prepare?(sql: string): DriverStatement;
  query?(sql: string): DriverStatement;
  close(): unknown;
}

export interface DriverStatement {
  run(...parameters: readonly unknown[]): unknown;
  get(...parameters: readonly unknown[]): unknown;
  all(...parameters: readonly unknown[]): unknown;
}

/** Builds one adapter while keeping runtime-specific imports in leaf modules. */
export function createSqliteAdapter(
  runtime: 'node' | 'bun',
  openDriver: (path: string, readOnly: boolean) => Promise<DriverDatabase>,
): SqliteAdapter {
  return {
    runtime,
    async open(path, options) {
      try {
        if (!Number.isSafeInteger(options.busyTimeoutMs) || options.busyTimeoutMs < 0 || options.busyTimeoutMs > 60_000)
          throw new Error('busyTimeoutMs must be 0..60000.');
        const database = await openDriver(path, options.readOnly);
        database.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs};`);
        database.exec('PRAGMA foreign_keys = ON;');
        return wrapDatabase(runtime, database);
      } catch (error: unknown) {
        throw normalizeDriverError(runtime, 'open', error);
      }
    },
  };
}

/** Wraps synchronous built-ins behind one bounded async-first contract. */
export function wrapDatabase(runtime: 'node' | 'bun', database: DriverDatabase): SqliteConnection {
  let closed = false;
  const ensureOpen = (): void => {
    if (closed) throw new Error(`SQLite ${runtime} connection is closed.`);
  };
  return {
    async exec(sql) {
      ensureOpen();
      await driverCall(runtime, 'execute SQL', () => database.exec(sql));
    },
    async prepare(sql) {
      ensureOpen();
      const statement = await driverCall(
        runtime,
        'prepare SQL',
        () => database.prepare?.(sql) ?? database.query?.(sql),
      );
      if (statement === undefined) throw new CacheSyncError(`SQLite ${runtime} driver cannot prepare statements.`);
      return {
        async run(parameters) {
          ensureOpen();
          const result = (await driverCall(runtime, 'run statement', () =>
            invoke(statement.run.bind(statement), parameters),
          )) as {
            changes?: number;
            lastInsertRowid?: number | bigint;
          };
          return { changes: result?.changes ?? 0, lastInsertRowid: result?.lastInsertRowid ?? 0 };
        },
        async get<T>(parameters?: SqliteParameters) {
          ensureOpen();
          return driverCall(
            runtime,
            'read row',
            () => invoke(statement.get.bind(statement), parameters) as T | undefined,
          );
        },
        async all<T>(parameters: SqliteParameters | undefined, bounds: { maxRows: number; maxBytes: number }) {
          ensureOpen();
          const rows = await driverCall(
            runtime,
            'read rows',
            () => invoke(statement.all.bind(statement), parameters) as T[],
          );
          if (!Array.isArray(rows)) throw new CacheSyncError(`SQLite ${runtime} driver returned a non-array row set.`);
          if (rows.length > bounds.maxRows) throw new ResourceLimitError('SQLite query exceeded maxRows.');
          let bytes = 0;
          for (const row of rows) {
            bytes += Buffer.byteLength(JSON.stringify(row, bigintJson));
            if (bytes > bounds.maxBytes) throw new ResourceLimitError('SQLite query exceeded maxBytes.');
          }
          return rows;
        },
      };
    },
    async close() {
      if (closed) return;
      await driverCall(runtime, 'close database', () => database.close());
      closed = true;
    },
  };
}

async function driverCall<T>(runtime: 'node' | 'bun', action: string, operation: () => T): Promise<T> {
  try {
    return operation();
  } catch (error: unknown) {
    throw normalizeDriverError(runtime, action, error);
  }
}

function normalizeDriverError(runtime: 'node' | 'bun', action: string, error: unknown): RepositoryStoreError {
  if (error instanceof RepositoryStoreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code = /busy|locked/iu.test(message) ? 'CACHE_BUSY' : 'CACHE_SYNC_FAILED';
  return new CacheSyncError(`SQLite ${runtime} ${action} failed: ${message}`, code, { cause: error });
}

function invoke(call: (...values: readonly unknown[]) => unknown, parameters: SqliteParameters | undefined): unknown {
  if (parameters === undefined) return call();
  return Array.isArray(parameters) ? call(...parameters) : call(parameters);
}

function bigintJson(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
