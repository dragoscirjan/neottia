import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { UnsupportedRuntimeError } from '../errors.js';

/** Native operation required to detach a name without replacing its destination. */
export interface NativePublicationBackend {
  renameNoReplace(source: string, destination: string): void;
  supportsLocalPath(path: string): boolean;
}

let injectedBackend: NativePublicationBackend | null | undefined;
let loadedBackend: NativePublicationBackend | undefined;
let loadFailure: unknown;

/** Returns the Linux Node-API backend or fails before a destructive mutation. */
export function requireNativePublicationBackend(): NativePublicationBackend {
  if (injectedBackend !== undefined) {
    if (injectedBackend !== null) return injectedBackend;
    throw unsupported('Native publication backend is disabled for this operation.');
  }
  if (process.platform !== 'linux')
    throw unsupported(`Exact destructive publication is unsupported on ${process.platform}.`);
  if (loadedBackend !== undefined) return loadedBackend;
  if (loadFailure !== undefined) throw unsupported('Native publication backend could not be loaded.', loadFailure);
  try {
    const require = createRequire(import.meta.url);
    const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
    const candidate = require(
      `${packageRoot}build/Release/repository_store_native.node`,
    ) as Partial<NativePublicationBackend>;
    if (typeof candidate.renameNoReplace !== 'function' || typeof candidate.supportsLocalPath !== 'function')
      throw new Error('Native addon does not expose the complete publication contract.');
    loadedBackend = candidate as NativePublicationBackend;
    return loadedBackend;
  } catch (error: unknown) {
    loadFailure = error;
    throw unsupported('Native publication backend could not be loaded.', error);
  }
}

/** Executes a no-replace move and normalizes unsupported kernel/filesystem errors. */
export function nativeRenameNoReplace(backend: NativePublicationBackend, source: string, destination: string): void {
  try {
    backend.renameNoReplace(source, destination);
  } catch (error: unknown) {
    if (['EINVAL', 'EXDEV', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].some((code) => hasCode(error, code)))
      throw unsupported(`Native no-replace move is unsupported for ${source}.`, error);
    throw error;
  }
}

/** Verifies that destructive publication is confined to known local filesystems. */
export function assertNativePublicationPath(backend: NativePublicationBackend, path: string): void {
  try {
    if (backend.supportsLocalPath(path)) return;
  } catch (error: unknown) {
    throw unsupported(`Native filesystem capability check failed for ${path}.`, error);
  }
  throw unsupported(`Exact destructive publication requires a supported Linux local filesystem: ${path}.`);
}

/** Installs an internal test backend; null deterministically models unavailability. */
export function setNativePublicationBackendForTests(backend: NativePublicationBackend | null | undefined): void {
  injectedBackend = backend;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function unsupported(message: string, cause?: unknown): UnsupportedRuntimeError {
  const error = new UnsupportedRuntimeError(message);
  if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause });
  return error;
}
