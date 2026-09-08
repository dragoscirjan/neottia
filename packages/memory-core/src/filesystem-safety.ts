import { constants as fsConstants, lstatSync, type Stats } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MemoryError } from './errors.js';

/** Stable identity for one directory in an absolute path. */
export interface DirectoryIdentity {
  readonly path: string;
  readonly stat: Stats;
}

/** Captures every directory component and rejects links or non-directories. */
export function captureDirectoryIdentities(directory: string, label: string): DirectoryIdentity[] {
  const paths: string[] = [];
  let current = resolve(directory);
  for (;;) {
    paths.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return paths.map((path) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new MemoryError(`Unsafe ${label}: ${path}`);
    return { path, stat };
  });
}

/** Fails when any captured path component has been rebound. */
export function revalidateDirectoryIdentities(identities: readonly DirectoryIdentity[], label: string): void {
  for (const identity of identities) {
    let current: Stats;
    try {
      current = lstatSync(identity.path);
    } catch (error: unknown) {
      throw new MemoryError(`${label} changed during access: ${identity.path}: ${describe(error)}`);
    }
    if (current.isSymbolicLink() || !current.isDirectory() || !sameFilesystemIdentity(identity.stat, current))
      throw new MemoryError(`${label} changed during access: ${identity.path}`);
  }
}

/** Compares device and inode, the stable identity exposed by Node stat calls. */
export function sameFilesystemIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Returns O_NOFOLLOW when the running Node platform exposes it. */
export function noFollowFlag(): number {
  return typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
}

/** Narrows Node filesystem exceptions by their portable errno code. */
export function isFilesystemErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
