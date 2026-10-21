import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { UnsupportedRuntimeError } from '../errors.js';

/** Native operation that atomically moves a path without replacing its destination. */
export interface ExactPublicationBackend {
  renameNoReplace(source: string, destination: string): void;
}

/** Native capability probe for certified local filesystem semantics. */
export interface LocalFilesystemBackend {
  supportsLocalPath(path: string): boolean;
}

/** Platform guarantees required by Repository Store leased operations. */
export interface RepositoryPlatformBackend {
  readonly id: string;
  readonly platform: NodeJS.Platform;
  readonly filesystemRequirement: string;
  readonly publication: ExactPublicationBackend;
  readonly filesystem: LocalFilesystemBackend;
}

interface PlatformBackendDefinition {
  readonly id: string;
  readonly platform: NodeJS.Platform;
  readonly filesystemRequirement: string;
}

interface NativePlatformModule {
  readonly platform: string;
  renameNoReplace(source: string, destination: string): void;
  supportsLocalPath(path: string): boolean;
}

const backendDefinitions: Partial<Record<NodeJS.Platform, PlatformBackendDefinition>> = {
  linux: {
    id: 'linux-node-api',
    platform: 'linux',
    filesystemRequirement: 'a certified Linux local filesystem',
  },
};

let injectedBackend: RepositoryPlatformBackend | null | undefined;
let loadedBackend: RepositoryPlatformBackend | undefined;
let loadFailure: unknown;

/** Returns the current certified platform backend or fails before leased work. */
export function requireRepositoryPlatformBackend(): RepositoryPlatformBackend {
  if (injectedBackend !== undefined) {
    if (injectedBackend !== null) return injectedBackend;
    throw unsupported('Repository platform backend is disabled for this operation.');
  }
  const definition = backendDefinitions[process.platform];
  if (definition === undefined)
    throw unsupported(`Repository filesystem operations are unsupported on ${process.platform}.`);
  if (loadedBackend !== undefined) return loadedBackend;
  if (loadFailure !== undefined) throw unsupported('Repository platform backend could not be loaded.', loadFailure);
  try {
    const nativeModule = loadNativeModule();
    if (nativeModule.platform !== definition.platform)
      throw new Error(
        `Native addon platform ${JSON.stringify(nativeModule.platform)} does not match ${JSON.stringify(definition.platform)}.`,
      );
    loadedBackend = Object.freeze({
      ...definition,
      publication: Object.freeze({ renameNoReplace: nativeModule.renameNoReplace.bind(nativeModule) }),
      filesystem: Object.freeze({ supportsLocalPath: nativeModule.supportsLocalPath.bind(nativeModule) }),
    });
    return loadedBackend;
  } catch (error: unknown) {
    loadFailure = error;
    throw unsupported('Repository platform backend could not be loaded.', error);
  }
}

/** Executes a no-replace move and normalizes unsupported platform errors. */
export function platformRenameNoReplace(backend: RepositoryPlatformBackend, source: string, destination: string): void {
  try {
    backend.publication.renameNoReplace(source, destination);
  } catch (error: unknown) {
    if (['EINVAL', 'EXDEV', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].some((code) => hasCode(error, code)))
      throw unsupported(`No-replace publication is unsupported for ${source}.`, error);
    throw error;
  }
}

/** Verifies that leased work is confined to a certified local filesystem. */
export function assertPlatformFilesystem(backend: RepositoryPlatformBackend, path: string): void {
  try {
    if (backend.filesystem.supportsLocalPath(path)) return;
  } catch (error: unknown) {
    throw unsupported(`Filesystem capability check failed for ${path}.`, error);
  }
  throw unsupported(`Repository Store requires ${backend.filesystemRequirement}: ${path}.`);
}

/** Installs an internal test backend; null deterministically models unavailability. */
export function setRepositoryPlatformBackendForTests(backend: RepositoryPlatformBackend | null | undefined): void {
  injectedBackend = backend;
}

function loadNativeModule(): NativePlatformModule {
  const require = createRequire(import.meta.url);
  const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
  const candidate = require(
    `${packageRoot}build/Release/repository_store_native.node`,
  ) as Partial<NativePlatformModule>;
  if (
    typeof candidate.platform !== 'string' ||
    typeof candidate.renameNoReplace !== 'function' ||
    typeof candidate.supportsLocalPath !== 'function'
  )
    throw new Error('Native addon does not expose the complete platform backend contract.');
  return candidate as NativePlatformModule;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function unsupported(message: string, cause?: unknown): UnsupportedRuntimeError {
  const error = new UnsupportedRuntimeError(message);
  if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause });
  return error;
}
