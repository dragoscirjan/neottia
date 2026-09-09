import { lstatSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PathSafetyError, ResourceLimitError } from './errors.js';
import {
  assertSafeRegular,
  captureDirectories,
  hasCode,
  readRegularFile,
  revalidateDirectories,
} from './internal/filesystem.js';
import {
  PATH_STATE,
  ROOT_STATE,
  managedPathBelongsToRoot,
  type ManagedPath,
  type ManagedRoot,
  type RepositoryLease,
} from './internal/model.js';
import { assertLiveLease, checkControl, type OperationControl } from './lease.js';
import { portablePathKey, resolveManagedPath } from './paths.js';
import { computeByteRevision, type ByteRevision } from './revision.js';

/** Exact bounded bytes and metadata returned from a safe managed read. */
export interface ManagedFile {
  readonly path: ManagedPath;
  readonly bytes: Uint8Array;
  readonly revision: ByteRevision;
  readonly size: number;
  readonly mtimeMs: number;
}

/** Options for bounded recursive discovery beneath domain-owned paths. */
export interface ScanManagedFilesOptions extends OperationControl {
  readonly under: readonly ManagedPath[];
  readonly accept?: (relativePath: string) => boolean;
}

/** Discovers safe regular files and rejects portable catalog collisions. */
export async function scanManagedFiles(
  root: ManagedRoot,
  lease: RepositoryLease,
  options: ScanManagedFilesOptions,
): Promise<readonly ManagedFile[]> {
  assertLiveLease(root, lease);
  checkControl(options);
  const rootState = root[ROOT_STATE];
  const discovered: ManagedPath[] = [];
  for (const start of options.under) {
    assertPathAuthority(root, start);
    walk(root, start[PATH_STATE].absolutePath, discovered, options.accept);
  }
  const keyed = new Map<string, string>();
  for (const path of discovered) {
    const key = portablePathKey(path.relativePath);
    const previous = keyed.get(key);
    if (previous !== undefined && previous !== path.relativePath)
      throw new PathSafetyError(`Portable path collision: ${previous} and ${path.relativePath}`, 'PATH_COLLISION');
    keyed.set(key, path.relativePath);
  }
  if (discovered.length > rootState.limits.maxFiles) throw new ResourceLimitError('Managed file count limit exceeded.');
  const results: ManagedFile[] = [];
  let totalBytes = 0;
  for (const path of discovered.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    checkControl(options);
    const file = await readManagedFile(root, lease, path, options);
    totalBytes += file.size;
    if (totalBytes > rootState.limits.maxTotalBytes)
      throw new ResourceLimitError('Managed aggregate byte limit exceeded.');
    results.push(file);
  }
  return results;
}

/** Reads one regular, singly-linked file through a no-follow descriptor. */
export async function readManagedFile(
  root: ManagedRoot,
  lease: RepositoryLease,
  path: ManagedPath,
  options: OperationControl = {},
): Promise<ManagedFile> {
  assertLiveLease(root, lease);
  assertPathAuthority(root, path);
  checkControl(options);
  const rootState = root[ROOT_STATE];
  const absolutePath = path[PATH_STATE].absolutePath;
  const bytes = readRegularFile(absolutePath, rootState.limits.maxFileBytes);
  const stat = lstatSync(absolutePath);
  assertSafeRegular(stat, absolutePath);
  checkControl(options);
  return { path, bytes, revision: computeByteRevision(bytes), size: bytes.byteLength, mtimeMs: stat.mtimeMs };
}

/** Returns a managed file when present without weakening safety failures. */
export async function readManagedFileIfExists(
  root: ManagedRoot,
  lease: RepositoryLease,
  path: ManagedPath,
  options: OperationControl = {},
): Promise<ManagedFile | undefined> {
  try {
    return await readManagedFile(root, lease, path, options);
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

/** Ensures an opaque path originated from the same authority as its root. */
export function assertPathAuthority(root: ManagedRoot, path: ManagedPath): void {
  if (!managedPathBelongsToRoot(root, path))
    throw new PathSafetyError('Managed path belongs to a different managed root.', 'PATH_INVALID');
}

function walk(
  root: ManagedRoot,
  absolute: string,
  output: ManagedPath[],
  accept: ((relativePath: string) => boolean) | undefined,
): void {
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new PathSafetyError(`Symbolic link is not allowed: ${absolute}`, 'UNSAFE_LINK');
  if (stat.isFile()) {
    assertSafeRegular(stat, absolute);
    const path = relative(root[ROOT_STATE].managedRoot, absolute).split('\\').join('/');
    if (accept?.(path) !== false) output.push(resolveManagedPath(root, path));
    return;
  }
  if (!stat.isDirectory()) throw new PathSafetyError(`Special managed path is not allowed: ${absolute}`, 'UNSAFE_LINK');
  const identities = captureDirectories(absolute);
  const entries = readdirSync(absolute, { withFileTypes: true });
  revalidateDirectories(identities);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink())
      throw new PathSafetyError(`Symbolic link is not allowed: ${join(absolute, entry.name)}`);
    walk(root, join(absolute, entry.name), output, accept);
  }
  revalidateDirectories(identities);
}
