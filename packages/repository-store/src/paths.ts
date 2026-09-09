import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { PathSafetyError, RepositoryStoreConfigError } from './errors.js';
import { ensurePrivateDirectory } from './internal/filesystem.js';
import {
  createManagedPath,
  createManagedRoot,
  getRootState,
  type ManagedPath,
  type ManagedRoot,
} from './internal/model.js';
import { DEFAULT_STORE_LIMITS, type StoreLimits } from './limits.js';

/** Options binding a managed subtree to its lease authority. */
export interface ManagedRootOptions {
  readonly authorityRoot: string;
  /** Omit only when the authority itself is the managed root. */
  readonly managedPath?: string;
  readonly limits: StoreLimits;
}

/** Resolves and creates a safe authority and managed root. */
export async function resolveManagedRoot(options: ManagedRootOptions): Promise<ManagedRoot> {
  validateLimits(options.limits);
  const authorityRoot = resolve(options.authorityRoot);
  ensurePrivateDirectory(authorityRoot);
  const managedRoot =
    options.managedPath === undefined ? authorityRoot : resolveWithin(authorityRoot, options.managedPath);
  ensurePrivateDirectory(managedRoot);
  const authorityId = createHash('sha256').update(authorityRoot).digest('hex');
  const managedIdentityPath =
    managedRoot === authorityRoot ? '.' : relative(authorityRoot, managedRoot).split(sep).join('/');
  const managedRootId = createHash('sha256').update(`${authorityId}\0${managedIdentityPath}`).digest('hex');
  const state = { authorityRoot, managedRoot, authorityId, managedRootId, limits: { ...options.limits } };
  return createManagedRoot(state);
}

/** Creates an authority-bound opaque path after portable normalization checks. */
export function resolveManagedPath(root: ManagedRoot, relativePath: string): ManagedPath {
  const state = getRootState(root);
  if (state === undefined) throw new RepositoryStoreConfigError('Managed root is not a repository-store handle.');
  const normalized = validateRelativePath(relativePath);
  const absolutePath = resolveWithin(state.managedRoot, normalized);
  return createManagedPath(normalized, {
    authorityId: state.authorityId,
    managedRootId: state.managedRootId,
    absolutePath,
  });
}

/** Validates the portable canonical path spelling shared by all domains. */
export function validateRelativePath(value: string): string {
  if (
    !value ||
    [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127) ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith('//')
  )
    throw new PathSafetyError(`Invalid managed relative path: ${JSON.stringify(value)}`);
  const components = value.split('/');
  if (
    components.some(
      (component) =>
        !component || component === '.' || component === '..' || component.endsWith('.') || component.endsWith(' '),
    )
  )
    throw new PathSafetyError(`Invalid managed relative path: ${JSON.stringify(value)}`);
  return components.join('/');
}

/** Portable key used to reject NFKC/case-equivalent catalog entries. */
export function portablePathKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

/** Locale-independent ordering used by durable manifests and recovery. */
export function compareCanonicalPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveWithin(root: string, value: string): string {
  const normalized = validateRelativePath(value.split(sep).join('/'));
  const absolute = resolve(root, normalized);
  const nested = relative(root, absolute);
  if (!nested || isAbsolute(nested) || nested === '..' || nested.startsWith(`..${sep}`))
    throw new PathSafetyError(`Managed path escapes authority: ${value}`);
  return absolute;
}

function validateLimits(limits: StoreLimits): void {
  for (const name of Object.keys(DEFAULT_STORE_LIMITS) as Array<keyof StoreLimits>) {
    const value = limits[name];
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RepositoryStoreConfigError(`Store limit ${name} must be a positive safe integer.`);
  }
}

export type { ManagedPath, ManagedRoot } from './internal/model.js';
