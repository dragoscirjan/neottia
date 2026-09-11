import { CacheSyncError, RepositoryStoreError, ResourceLimitError } from '../errors.js';
import { DEFAULT_STORE_LIMITS } from '../limits.js';

/** Values with portable binding semantics across Node and Bun SQLite drivers. */
export type SqliteValue = null | string | number | bigint | Uint8Array;
export type SqliteParameters = readonly SqliteValue[] | Readonly<Record<string, SqliteValue>>;

/** Connection-level ceilings that callers cannot raise per query. */
export interface SqliteConnectionBounds {
  readonly maxSqlBytes: number;
  readonly maxStatementParameterBytes: number;
  readonly maxQueryRows: number;
  readonly maxQueryResultBytes: number;
}

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
    options: {
      readonly readOnly: boolean;
      readonly busyTimeoutMs: number;
      readonly limits?: SqliteConnectionBounds;
    },
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
  iterate?(...parameters: readonly unknown[]): Iterable<unknown>;
}

const DEFAULT_CONNECTION_BOUNDS: SqliteConnectionBounds = {
  maxSqlBytes: DEFAULT_STORE_LIMITS.maxSqlBytes,
  maxStatementParameterBytes: DEFAULT_STORE_LIMITS.maxStatementParameterBytes,
  maxQueryRows: DEFAULT_STORE_LIMITS.maxQueryRows,
  maxQueryResultBytes: DEFAULT_STORE_LIMITS.maxQueryResultBytes,
};

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
        const limits = validateConnectionBounds(options.limits ?? DEFAULT_CONNECTION_BOUNDS);
        const database = await openDriver(path, options.readOnly);
        const connection = wrapDatabase(runtime, database, limits);
        await connection.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs};`);
        await connection.exec('PRAGMA foreign_keys = ON;');
        return connection;
      } catch (error: unknown) {
        throw normalizeDriverError(runtime, 'open', error);
      }
    },
  };
}

/** Wraps synchronous built-ins behind one bounded async-first contract. */
export function wrapDatabase(
  runtime: 'node' | 'bun',
  database: DriverDatabase,
  suppliedBounds: SqliteConnectionBounds = DEFAULT_CONNECTION_BOUNDS,
): SqliteConnection {
  const connectionBounds = validateConnectionBounds(suppliedBounds);
  let closed = false;
  const ensureOpen = (): void => {
    if (closed) throw new Error(`SQLite ${runtime} connection is closed.`);
  };
  return {
    async exec(sql) {
      ensureOpen();
      assertSqlBound(sql, connectionBounds.maxSqlBytes);
      await driverCall(runtime, 'execute SQL', () => database.exec(sql));
    },
    async prepare(sql) {
      ensureOpen();
      assertSqlBound(sql, connectionBounds.maxSqlBytes);
      const statement = await driverCall(
        runtime,
        'prepare SQL',
        () => database.prepare?.(sql) ?? database.query?.(sql),
      );
      if (statement === undefined) throw new CacheSyncError(`SQLite ${runtime} driver cannot prepare statements.`);
      return {
        async run(parameters) {
          ensureOpen();
          assertParameterBound(parameters, connectionBounds.maxStatementParameterBytes);
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
          assertParameterBound(parameters, connectionBounds.maxStatementParameterBytes);
          const row = await driverCall(
            runtime,
            'read row',
            () => invoke(statement.get.bind(statement), parameters) as T | undefined,
          );
          if (row !== undefined && measureRow(row) > connectionBounds.maxQueryResultBytes)
            throw new ResourceLimitError('SQLite get result exceeded maxQueryResultBytes.');
          return row;
        },
        async all<T>(parameters: SqliteParameters | undefined, bounds: { maxRows: number; maxBytes: number }) {
          ensureOpen();
          assertParameterBound(parameters, connectionBounds.maxStatementParameterBytes);
          const requested = validateQueryBounds(bounds);
          const effective = {
            maxRows: Math.min(requested.maxRows, connectionBounds.maxQueryRows),
            maxBytes: Math.min(requested.maxBytes, connectionBounds.maxQueryResultBytes),
          };
          if (statement.iterate === undefined)
            throw new CacheSyncError(`SQLite ${runtime} driver does not expose bounded cursor iteration.`);
          const iterable = await driverCall(runtime, 'iterate rows', () =>
            invoke(statement.iterate?.bind(statement) as (...values: readonly unknown[]) => unknown, parameters),
          );
          if (iterable === null || typeof iterable !== 'object' || !(Symbol.iterator in iterable))
            throw new CacheSyncError(`SQLite ${runtime} driver returned a non-iterable row cursor.`);
          return boundedRows(iterable as Iterable<T>, effective);
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

function boundedRows<T>(rows: Iterable<T>, bounds: { maxRows: number; maxBytes: number }): T[] {
  const result: T[] = [];
  let bytes = 0;
  for (const row of rows) {
    if (result.length >= bounds.maxRows) throw new ResourceLimitError('SQLite query exceeded maxRows.');
    bytes += measureRow(row);
    if (bytes > bounds.maxBytes) throw new ResourceLimitError('SQLite query exceeded maxBytes.');
    result.push(row);
  }
  return result;
}

/** Measures SQLite scalar rows without allocating an unbounded JSON copy. */
function measureRow(value: unknown, seen = new Set<object>()): number {
  if (value === null) return 1;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (typeof value === 'number') return 8;
  if (typeof value === 'bigint') return Buffer.byteLength(value.toString());
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value !== 'object') throw new CacheSyncError('SQLite driver returned an unsupported row value.');
  if (seen.has(value)) throw new CacheSyncError('SQLite driver returned a cyclic row value.');
  seen.add(value);
  let bytes = 0;
  for (const [key, item] of Object.entries(value)) bytes += Buffer.byteLength(key) + measureRow(item, seen);
  seen.delete(value);
  return bytes;
}

function assertSqlBound(sql: string, maxBytes: number): void {
  if (Buffer.byteLength(sql, 'utf8') > maxBytes) throw new ResourceLimitError('SQLite SQL exceeds maxSqlBytes.');
}

function assertParameterBound(parameters: SqliteParameters | undefined, maxBytes: number): void {
  if (parameters === undefined) return;
  const values = Array.isArray(parameters) ? parameters : Object.values(parameters);
  let bytes = 0;
  for (const value of values) {
    if (value === null) bytes += 1;
    else if (typeof value === 'string') bytes += Buffer.byteLength(value, 'utf8');
    else if (typeof value === 'number') bytes += 8;
    else if (typeof value === 'bigint') bytes += Buffer.byteLength(value.toString(), 'utf8');
    else if (value instanceof Uint8Array) bytes += value.byteLength;
    else throw new ResourceLimitError('SQLite statement contains an unsupported parameter value.');
    if (bytes > maxBytes) throw new ResourceLimitError('SQLite parameters exceed maxStatementParameterBytes.');
  }
}

function validateConnectionBounds(bounds: SqliteConnectionBounds): SqliteConnectionBounds {
  for (const [name, value] of Object.entries(bounds))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new ResourceLimitError(`SQLite connection bound ${name} must be a positive safe integer.`);
  return { ...bounds };
}

function validateQueryBounds(bounds: { maxRows: number; maxBytes: number }): { maxRows: number; maxBytes: number } {
  if (
    !Number.isSafeInteger(bounds.maxRows) ||
    bounds.maxRows <= 0 ||
    !Number.isSafeInteger(bounds.maxBytes) ||
    bounds.maxBytes <= 0
  )
    throw new ResourceLimitError('SQLite query bounds must be positive safe integers.');
  return bounds;
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
