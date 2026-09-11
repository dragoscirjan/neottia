import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DurabilityError, PathSafetyError, ResourceLimitError } from '../errors.js';
import { emitFilesystemFault } from './fault-injection.js';

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

/** Reads exact bytes through a fixed-size no-follow descriptor buffer. */
export function readRegularFile(
  path: string,
  maxBytes: number,
  options: { readonly allowedLinkCounts?: readonly number[] } = {},
): Uint8Array {
  return readRegularFileWithIdentity(path, maxBytes, options).bytes;
}

/** Returns bytes together with the descriptor-verified filesystem identity. */
export function readRegularFileWithIdentity(
  path: string,
  maxBytes: number,
  options: { readonly allowedLinkCounts?: readonly number[] } = {},
): { readonly bytes: Uint8Array; readonly identity: Stats } {
  const parents = captureDirectories(dirname(path));
  const allowedLinkCounts = options.allowedLinkCounts ?? [1];
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | noFollowFlag());
    const before = fstatSync(descriptor);
    assertRegularWithLinks(before, path, allowedLinkCounts);
    if (before.size > maxBytes) throw new ResourceLimitError(`Managed file exceeds configured byte limit: ${path}`);
    const pathBefore = lstatSync(path);
    if (pathBefore.isSymbolicLink() || !sameIdentity(before, pathBefore))
      throw unsafe(`Managed file identity changed before read: ${path}`, 'IDENTITY_CHANGED');
    emitFilesystemFault('bounded-read-opened', path);
    const capacity = Math.min(maxBytes + 1, before.size + 1);
    const buffer = Buffer.allocUnsafe(capacity);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new ResourceLimitError(`Managed file exceeds configured byte limit: ${path}`);
    const after = fstatSync(descriptor);
    assertRegularWithLinks(after, path, allowedLinkCounts);
    if (
      !sameIdentity(before, after) ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.nlink !== after.nlink ||
      offset !== before.size
    )
      throw unsafe(`Managed file changed during read: ${path}`, 'IDENTITY_CHANGED');
    const pathAfter = lstatSync(path);
    if (pathAfter.isSymbolicLink() || !sameIdentity(after, pathAfter))
      throw unsafe(`Managed file identity changed after read: ${path}`, 'IDENTITY_CHANGED');
    revalidateDirectories(parents);
    return { bytes: buffer.subarray(0, offset), identity: after };
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
  assertRegularWithLinks(stat, path, [1]);
}

function assertRegularWithLinks(stat: Stats, path: string, allowedLinkCounts: readonly number[]): void {
  if (stat.isSymbolicLink() || !stat.isFile())
    throw unsafe(`Managed path is not a regular file: ${path}`, 'UNSAFE_LINK');
  if (!allowedLinkCounts.includes(stat.nlink))
    throw unsafe(`Managed file has an unsafe hard-link count: ${path}`, 'UNSAFE_HARD_LINK');
}

/** Synchronizes an already-open file descriptor with structured failures. */
export function syncFileDescriptor(descriptor: number, path: string): void {
  try {
    emitFilesystemFault('file-fsync', path);
    fsyncSync(descriptor);
  } catch (error: unknown) {
    throw new DurabilityError(`Failed to synchronize file: ${path}`, {
      cause: error,
      evidence: { operation: 'file-fsync', path },
    });
  }
}

/** Synchronizes a verified regular file after a path-only subsystem closes it. */
export function syncRegularFile(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    assertSafeRegular(opened, path);
    syncFileDescriptor(descriptor, path);
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
    try {
      emitFilesystemFault('directory-fsync', path);
      fsyncSync(descriptor);
    } catch (error: unknown) {
      throw new DurabilityError(`Failed to synchronize directory: ${path}`, {
        cause: error,
        evidence: { operation: 'directory-fsync', path },
      });
    }
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
