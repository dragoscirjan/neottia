import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { PathSafetyError, ResourceLimitError } from '../errors.js';

/** Stable identity for one existing directory component. */
export interface DirectoryIdentity {
  readonly path: string;
  readonly stat: Stats;
}

/** Returns O_NOFOLLOW where the host exposes it. */
export function noFollowFlag(): number {
  return typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
}

/** Narrows portable Node filesystem errors by errno code. */
export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

/** Device and inode identify an opened filesystem object on supported hosts. */
export function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Creates a directory chain without traversing symbolic links. */
export function ensurePrivateDirectory(target: string): void {
  const missing: string[] = [];
  let current = resolve(target);
  while (true) {
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafe(`Unsafe directory: ${current}`);
      break;
    } catch (error: unknown) {
      if (!hasCode(error, 'ENOENT')) throw error;
      const parent = dirname(current);
      if (parent === current) throw unsafe(`Cannot resolve directory ancestor: ${target}`);
      missing.unshift(basename(current));
      current = parent;
    }
  }
  for (const component of missing) {
    current = join(current, component);
    try {
      mkdirSync(current, { mode: 0o700 });
    } catch (error: unknown) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafe(`Unsafe directory: ${current}`);
  }
}

/** Captures every ancestor so later path rebinding is detectable. */
export function captureDirectories(directory: string): DirectoryIdentity[] {
  const paths = ancestorPaths(resolve(directory));
  const identities: DirectoryIdentity[] = [];
  for (const path of paths) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafe(`Unsafe directory ancestor: ${path}`);
    identities.push({ path, stat });
  }
  return identities;
}

function ancestorPaths(path: string): string[] {
  const parent = dirname(path);
  return parent === path ? [path] : [...ancestorPaths(parent), path];
}

/** Fails if an ancestor captured before an operation was rebound. */
export function revalidateDirectories(identities: readonly DirectoryIdentity[]): void {
  for (const identity of identities) {
    let current: Stats;
    try {
      current = lstatSync(identity.path);
    } catch (error: unknown) {
      throw unsafe(`Directory changed during access: ${identity.path}`, 'IDENTITY_CHANGED', error);
    }
    if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(identity.stat, current))
      throw unsafe(`Directory changed during access: ${identity.path}`, 'IDENTITY_CHANGED');
  }
}

/** Reads exact bytes through a no-follow descriptor with pre/post metadata checks. */
export function readRegularFile(path: string, maxBytes: number): Uint8Array {
  const parents = captureDirectories(dirname(path));
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | noFollowFlag());
    const before = fstatSync(descriptor);
    assertSafeRegular(before, path);
    if (before.size > maxBytes) throw new ResourceLimitError(`Managed file exceeds maxFileBytes: ${path}`);
    const pathBefore = lstatSync(path);
    if (pathBefore.isSymbolicLink() || !sameIdentity(before, pathBefore))
      throw unsafe(`Managed file identity changed before read: ${path}`, 'IDENTITY_CHANGED');
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (
      !sameIdentity(before, after) ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      bytes.byteLength !== before.size
    )
      throw unsafe(`Managed file changed during read: ${path}`, 'IDENTITY_CHANGED');
    const pathAfter = lstatSync(path);
    if (pathAfter.isSymbolicLink() || !sameIdentity(after, pathAfter))
      throw unsafe(`Managed file identity changed after read: ${path}`, 'IDENTITY_CHANGED');
    revalidateDirectories(parents);
    return bytes;
  } catch (error: unknown) {
    if (error instanceof PathSafetyError || error instanceof ResourceLimitError) throw error;
    if (hasCode(error, 'ELOOP')) throw unsafe(`Symbolic link is not allowed: ${path}`, 'UNSAFE_LINK', error);
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Rejects symbolic links, special files, and multiply linked regular files. */
export function assertSafeRegular(stat: Stats, path: string): void {
  if (stat.isSymbolicLink() || !stat.isFile())
    throw unsafe(`Managed path is not a regular file: ${path}`, 'UNSAFE_LINK');
  if (stat.nlink !== 1) throw unsafe(`Managed file has multiple hard links: ${path}`, 'UNSAFE_HARD_LINK');
}

/** Synchronizes a verified regular file after a path-only subsystem closes it. */
export function syncRegularFile(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    assertSafeRegular(opened, path);
    fsyncSync(descriptor);
    const current = lstatSync(path);
    if (!sameIdentity(opened, current))
      throw unsafe(`File changed during synchronization: ${path}`, 'IDENTITY_CHANGED');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Synchronizes a directory on POSIX; Windows lacks equivalent guarantees. */
export function syncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | noFollowFlag());
    const stat = fstatSync(descriptor);
    if (!stat.isDirectory()) throw unsafe(`Unsafe directory: ${path}`);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function unsafe(
  message: string,
  code: 'UNSAFE_LINK' | 'UNSAFE_HARD_LINK' | 'IDENTITY_CHANGED' = 'UNSAFE_LINK',
  cause?: unknown,
): PathSafetyError {
  const error = new PathSafetyError(message, code);
  if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  return error;
}
