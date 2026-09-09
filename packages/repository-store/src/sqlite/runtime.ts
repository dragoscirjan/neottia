import { UnsupportedRuntimeError } from '../errors.js';
import type { SqliteAdapter } from './adapter.js';

/** Selects Bun first, otherwise the supported Node built-in, without eager imports. */
export async function selectSqliteAdapter(): Promise<SqliteAdapter> {
  if (typeof Bun !== 'undefined') {
    if (!atLeast(Bun.version, [1, 3, 13]))
      throw new UnsupportedRuntimeError(`bun:sqlite requires Bun >=1.3.13; current version is ${Bun.version}.`);
    return (await import('./bun.js')).bunSqliteAdapter;
  }
  if (typeof process !== 'undefined' && process.versions?.node !== undefined) {
    if (!supportedNode(process.versions.node))
      throw new UnsupportedRuntimeError(
        `node:sqlite requires Node >=22.16.0; current version is ${process.versions.node}.`,
      );
    return (await import('./node.js')).nodeSqliteAdapter;
  }
  throw new UnsupportedRuntimeError('SQLite cache requires Node >=22.16.0 or Bun >=1.3.13.');
}

function supportedNode(version: string): boolean {
  return atLeast(version, [22, 16, 0]);
}

function atLeast(version: string, minimum: readonly [number, number, number]): boolean {
  const parts = version.split('.').map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    const actual = parts[index] ?? 0;
    const required = minimum[index] ?? 0;
    if (actual !== required) return actual > required;
  }
  return true;
}

declare const Bun: undefined | { readonly version: string };
