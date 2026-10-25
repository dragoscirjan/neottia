import { fsyncSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { UnsupportedRuntimeError } from '../errors.js';
import { verifyNativeAddonIntegrity } from './native-integrity.js';

/** Native operation that atomically moves a path without replacing its destination. */
export interface ExactPublicationBackend {
  renameNoReplace(source: string, destination: string): void;
}

/** Native filesystem properties used by deterministic diagnostics. */
export interface LocalPathInspection {
  readonly filesystemType: string;
  readonly certified: boolean;
  readonly local: boolean;
  readonly writable: boolean;
  readonly hardLinks: boolean;
  readonly stableIdentity: boolean;
  readonly atomicNoReplace: boolean;
  readonly durability: boolean;
}

/** Native capability probe for certified local filesystem semantics. */
export interface LocalFilesystemBackend {
  supportsLocalPath(path: string): boolean;
  inspectLocalPath?(path: string): LocalPathInspection;
}

/** Native descriptor flush with the durability barrier required by the platform. */
export interface DurabilityBackend {
  syncDescriptor(descriptor: number): void;
}

/** Platform guarantees required by Repository Store leased operations. */
export interface RepositoryPlatformBackend {
  readonly id: string;
  readonly platform: NodeJS.Platform;
  readonly filesystemRequirement: string;
  readonly leaseArtifact: 'directory' | 'file';
  readonly publication: ExactPublicationBackend;
  readonly filesystem: LocalFilesystemBackend;
  readonly durability: DurabilityBackend;
}

interface PlatformBackendDefinition {
  readonly id: string;
  readonly platform: NodeJS.Platform;
  readonly architectures: readonly string[];
  readonly runtimes: readonly RepositoryRuntime[];
  readonly filesystemRequirement: string;
  readonly leaseArtifact: 'directory' | 'file';
}

export type RepositoryRuntime = 'node' | 'bun';

export interface RepositoryPlatformTupleSupport {
  readonly platformKnown: boolean;
  readonly architectureCertified: boolean;
  readonly runtimeCertified: boolean;
  readonly certified: boolean;
}

interface NativePlatformModule {
  readonly platform: string;
  renameNoReplace(source: string, destination: string): void;
  inspectLocalPath(path: string): unknown;
  supportsLocalPath(path: string): boolean;
  syncDescriptor(descriptor: number): void;
}

const backendDefinitions: Partial<Record<NodeJS.Platform, PlatformBackendDefinition>> = {
  linux: {
    id: 'linux-node-api',
    platform: 'linux',
    architectures: ['x64', 'arm64'],
    runtimes: ['node', 'bun'],
    filesystemRequirement: 'a certified Linux local filesystem',
    leaseArtifact: 'directory',
  },
  darwin: {
    id: 'macos-node-api',
    platform: 'darwin',
    architectures: ['x64', 'arm64'],
    runtimes: ['node', 'bun'],
    filesystemRequirement: 'a local APFS filesystem with certified publication and durability capabilities',
    leaseArtifact: 'directory',
  },
  win32: {
    id: 'windows-node-api',
    platform: 'win32',
    architectures: ['x64'],
    runtimes: ['node', 'bun'],
    filesystemRequirement: 'a local NTFS filesystem with stable identity and hard-link capabilities',
    leaseArtifact: 'directory',
  },
  freebsd: {
    id: 'freebsd-node-api',
    platform: 'freebsd',
    architectures: ['x64'],
    runtimes: ['node'],
    filesystemRequirement: 'a local UFS2 filesystem with regular-file hard links and directory fsync',
    leaseArtifact: 'file',
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
  const definition = selectBackendDefinition(process.platform, process.arch);
  const runtime = currentRepositoryRuntime();
  if (definition === undefined || !definition.runtimes.includes(runtime))
    throw unsupported(
      `Repository filesystem operations are unsupported on ${runtime} ${process.platform}-${process.arch}.`,
    );
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
      filesystem: Object.freeze({
        supportsLocalPath: nativeModule.supportsLocalPath.bind(nativeModule),
        inspectLocalPath: (path: string) => validateLocalPathInspection(nativeModule.inspectLocalPath(path)),
      }),
      durability: Object.freeze({
        syncDescriptor: definition.platform === 'win32' ? fsyncSync : nativeModule.syncDescriptor.bind(nativeModule),
      }),
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

/** Reports whether a platform and architecture tuple has a certified backend. */
export function isCertifiedRepositoryPlatform(platform: NodeJS.Platform, architecture: string): boolean {
  return selectBackendDefinition(platform, architecture) !== undefined;
}

/** Classifies one platform, architecture, and runtime tuple without loading native code. */
export function repositoryPlatformTupleSupport(
  platform: NodeJS.Platform,
  architecture: string,
  runtime: RepositoryRuntime,
): RepositoryPlatformTupleSupport {
  const definition = backendDefinitions[platform];
  const platformKnown = definition !== undefined;
  const architectureCertified = definition?.architectures.includes(architecture) === true;
  const runtimeCertified = definition?.runtimes.includes(runtime) === true;
  return Object.freeze({
    platformKnown,
    architectureCertified,
    runtimeCertified,
    certified: platformKnown && architectureCertified && runtimeCertified,
  });
}

export function currentRepositoryRuntime(): RepositoryRuntime {
  return typeof process.versions.bun === 'string' ? 'bun' : 'node';
}

function selectBackendDefinition(
  platform: NodeJS.Platform,
  architecture: string,
): PlatformBackendDefinition | undefined {
  const definition = backendDefinitions[platform];
  return definition?.architectures.includes(architecture) === true ? definition : undefined;
}

function loadNativeModule(): NativePlatformModule {
  const require = createRequire(import.meta.url);
  const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
  const candidate = require(verifyNativeAddonIntegrity(packageRoot)) as Partial<NativePlatformModule>;
  if (
    typeof candidate.platform !== 'string' ||
    typeof candidate.renameNoReplace !== 'function' ||
    typeof candidate.inspectLocalPath !== 'function' ||
    typeof candidate.supportsLocalPath !== 'function' ||
    typeof candidate.syncDescriptor !== 'function'
  )
    throw new Error('Native addon does not expose the complete platform backend contract.');
  return candidate as NativePlatformModule;
}

function validateLocalPathInspection(value: unknown): LocalPathInspection {
  if (typeof value !== 'object' || value === null) throw new Error('Native filesystem inspection is malformed.');
  const candidate = value as Partial<Record<keyof LocalPathInspection, unknown>>;
  const booleanFields = [
    'certified',
    'local',
    'writable',
    'hardLinks',
    'stableIdentity',
    'atomicNoReplace',
    'durability',
  ] as const;
  if (
    typeof candidate.filesystemType !== 'string' ||
    candidate.filesystemType.length === 0 ||
    booleanFields.some((field) => typeof candidate[field] !== 'boolean')
  )
    throw new Error('Native filesystem inspection is malformed.');
  return Object.freeze({
    filesystemType: candidate.filesystemType,
    certified: candidate.certified,
    local: candidate.local,
    writable: candidate.writable,
    hardLinks: candidate.hardLinks,
    stableIdentity: candidate.stableIdentity,
    atomicNoReplace: candidate.atomicNoReplace,
    durability: candidate.durability,
  }) as LocalPathInspection;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function unsupported(message: string, cause?: unknown): UnsupportedRuntimeError {
  const error = new UnsupportedRuntimeError(message);
  if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause });
  return error;
}
