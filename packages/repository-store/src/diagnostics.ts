import { constants, type BigIntStats } from 'node:fs';
import { link, lstat, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  currentRepositoryRuntime,
  repositoryPlatformTupleSupport,
  requireRepositoryPlatformBackend,
  type LocalPathInspection,
  type RepositoryPlatformBackend,
  type RepositoryRuntime,
} from './internal/platform-backend.js';

/** Stable result for one Repository Store platform requirement. */
export interface RepositoryPlatformCheck {
  readonly id:
    | 'platform'
    | 'architecture'
    | 'runtime'
    | 'native-backend'
    | 'filesystem-type'
    | 'filesystem-local'
    | 'filesystem-writable'
    | 'atomic-no-replace'
    | 'hard-links'
    | 'stable-identity'
    | 'file-durability'
    | 'directory-durability';
  readonly status: 'pass' | 'fail';
  readonly message: string;
  readonly reason?:
    | 'UNSUPPORTED_PLATFORM'
    | 'UNSUPPORTED_ARCHITECTURE'
    | 'UNSUPPORTED_RUNTIME'
    | 'NATIVE_ADDON_UNAVAILABLE'
    | 'FILESYSTEM_UNCERTIFIED'
    | 'FILESYSTEM_NON_LOCAL'
    | 'FILESYSTEM_READ_ONLY'
    | 'ATOMIC_NO_REPLACE_UNAVAILABLE'
    | 'HARD_LINKS_UNAVAILABLE'
    | 'STABLE_IDENTITY_UNAVAILABLE'
    | 'FILE_DURABILITY_UNAVAILABLE'
    | 'DIRECTORY_DURABILITY_UNAVAILABLE';
  readonly remediation?: string;
}

/** Platform facts and probe results without machine-specific paths. */
export interface RepositoryPlatformDiagnostics {
  readonly schemaVersion: 1;
  readonly status: 'pass' | 'fail';
  readonly runtime: {
    readonly name: RepositoryRuntime;
    readonly version: string;
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
  };
  readonly backend: {
    readonly available: boolean;
    readonly id: string | null;
    readonly leaseArtifact: 'directory' | 'file' | null;
    readonly filesystemRequirement: string | null;
  };
  readonly filesystem: {
    readonly type: string | null;
    readonly local: boolean | null;
    readonly writable: boolean | null;
  };
  readonly durabilityModel: string | null;
  readonly checks: readonly RepositoryPlatformCheck[];
}

interface ActiveProbeResult {
  readonly temporaryArea: boolean;
  readonly atomicNoReplace: boolean;
  readonly hardLinks: boolean;
  readonly stableIdentity: boolean;
  readonly fileDurability: boolean;
  readonly directoryDurability: boolean;
}

/** Diagnoses the Repository Store backend and target filesystem in a private temporary area. */
export async function diagnoseRepositoryPlatform(root: string): Promise<RepositoryPlatformDiagnostics> {
  const runtime = currentRepositoryRuntime();
  const tuple = repositoryPlatformTupleSupport(process.platform, process.arch, runtime);
  const checks: RepositoryPlatformCheck[] = [];
  checks.push(
    check(
      'platform',
      tuple.platformKnown,
      `Platform ${process.platform} has a certified Repository Store backend.`,
      'UNSUPPORTED_PLATFORM',
      `Platform ${process.platform} is not certified for Repository Store.`,
      'Use Linux, macOS, Windows Server, or FreeBSD as listed in the support matrix.',
    ),
  );
  checks.push(
    check(
      'architecture',
      tuple.architectureCertified,
      `Architecture ${process.arch} is certified on ${process.platform}.`,
      'UNSUPPORTED_ARCHITECTURE',
      `Architecture ${process.arch} is not certified on ${process.platform}.`,
      'Use a certified architecture from the Repository Store support matrix.',
    ),
  );
  checks.push(
    check(
      'runtime',
      tuple.runtimeCertified,
      `Runtime ${runtime} is certified on ${process.platform}-${process.arch}.`,
      'UNSUPPORTED_RUNTIME',
      `Runtime ${runtime} is not certified on ${process.platform}-${process.arch}.`,
      'Use a runtime listed for this platform tuple in the Repository Store support matrix.',
    ),
  );

  let backend: RepositoryPlatformBackend | undefined;
  if (tuple.certified) {
    try {
      backend = requireRepositoryPlatformBackend();
    } catch {
      // The stable diagnostic below intentionally omits loader paths and untrusted native errors.
    }
  }
  checks.push(
    check(
      'native-backend',
      backend !== undefined,
      'The native Repository Store backend loaded and passed its integrity receipt check.',
      'NATIVE_ADDON_UNAVAILABLE',
      'The native Repository Store backend is unavailable or failed its integrity check.',
      'Reinstall @neottia/repository-store, or install the C++17 source-build prerequisites and reinstall.',
    ),
  );

  let inspection: LocalPathInspection | undefined;
  let probe: ActiveProbeResult | undefined;
  if (backend !== undefined) {
    try {
      const canonicalRoot = await realpath(root);
      const metadata = await lstat(canonicalRoot);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Diagnostic root is not a directory.');
      inspection = backend.filesystem.inspectLocalPath?.(canonicalRoot);
      if (inspection !== undefined) probe = await runActiveProbes(canonicalRoot, backend);
    } catch {
      // Each absent result becomes a stable failed check below.
    }
  }

  checks.push(
    check(
      'filesystem-type',
      inspection?.certified === true,
      `Filesystem ${inspection?.filesystemType ?? 'unknown'} is certified for this platform.`,
      'FILESYSTEM_UNCERTIFIED',
      `Filesystem ${inspection?.filesystemType ?? 'unknown'} is not certified for this platform.`,
      backend?.filesystemRequirement ?? 'Use a certified local filesystem from the Repository Store support matrix.',
    ),
  );
  checks.push(
    check(
      'filesystem-local',
      inspection?.local === true,
      'The target is on a local filesystem.',
      'FILESYSTEM_NON_LOCAL',
      'The target is not on a certified local filesystem.',
      'Move the repository to a local filesystem. Network and shared filesystems are unsupported.',
    ),
  );
  checks.push(
    check(
      'filesystem-writable',
      inspection?.writable === true && probe?.temporaryArea === true,
      'The target filesystem is writable and the private diagnostic area was removed.',
      'FILESYSTEM_READ_ONLY',
      'The target filesystem is read-only or does not permit a private diagnostic area.',
      'Use a writable repository on a certified local filesystem.',
    ),
  );
  checks.push(
    capabilityCheck(
      'atomic-no-replace',
      inspection?.atomicNoReplace === true && probe?.atomicNoReplace === true,
      'Atomic no-replace publication succeeded and refused an existing destination.',
      'ATOMIC_NO_REPLACE_UNAVAILABLE',
      'Atomic no-replace publication is unavailable.',
      'Use the certified filesystem and native backend for this platform.',
    ),
  );
  checks.push(
    capabilityCheck(
      'hard-links',
      inspection?.hardLinks === true && probe?.hardLinks === true,
      'Same-filesystem regular-file hard links preserve the source bytes.',
      'HARD_LINKS_UNAVAILABLE',
      'Required regular-file hard links are unavailable.',
      'Use a certified local filesystem with regular-file hard-link support.',
    ),
  );
  checks.push(
    capabilityCheck(
      'stable-identity',
      inspection?.stableIdentity === true && probe?.stableIdentity === true,
      'Descriptor and path metadata expose one stable filesystem identity.',
      'STABLE_IDENTITY_UNAVAILABLE',
      'Stable filesystem identity is unavailable.',
      'Use a certified filesystem that exposes stable device and file identities.',
    ),
  );
  checks.push(
    capabilityCheck(
      'file-durability',
      inspection?.durability === true && probe?.fileDurability === true,
      'The platform file durability barrier completed.',
      'FILE_DURABILITY_UNAVAILABLE',
      'The required file durability barrier is unavailable.',
      'Use the certified filesystem and runtime durability support for this platform.',
    ),
  );
  checks.push(
    capabilityCheck(
      'directory-durability',
      inspection?.durability === true && probe?.directoryDurability === true,
      process.platform === 'win32'
        ? 'NTFS journaling provides the certified namespace durability model.'
        : 'The platform directory durability barrier completed.',
      'DIRECTORY_DURABILITY_UNAVAILABLE',
      'The required namespace durability model is unavailable.',
      'Use the certified filesystem and namespace durability model for this platform.',
    ),
  );

  const frozenChecks = Object.freeze(checks.map((result) => Object.freeze(result)));
  return Object.freeze({
    schemaVersion: 1,
    status: frozenChecks.some((result) => result.status === 'fail') ? 'fail' : 'pass',
    runtime: Object.freeze({
      name: runtime,
      version: runtime === 'bun' ? (process.versions.bun ?? process.version) : process.version,
      platform: process.platform,
      architecture: process.arch,
    }),
    backend: Object.freeze({
      available: backend !== undefined,
      id: backend?.id ?? null,
      leaseArtifact: backend?.leaseArtifact ?? null,
      filesystemRequirement: backend?.filesystemRequirement ?? null,
    }),
    filesystem: Object.freeze({
      type: inspection?.filesystemType ?? null,
      local: inspection?.local ?? null,
      writable: inspection?.writable ?? null,
    }),
    durabilityModel: durabilityModel(backend),
    checks: frozenChecks,
  });
}

function check(
  id: RepositoryPlatformCheck['id'],
  passed: boolean,
  passedMessage: string,
  reason: NonNullable<RepositoryPlatformCheck['reason']>,
  failedMessage: string,
  remediation: string,
): RepositoryPlatformCheck {
  return passed
    ? { id, status: 'pass', message: passedMessage }
    : { id, status: 'fail', message: failedMessage, reason, remediation };
}

function capabilityCheck(
  id: RepositoryPlatformCheck['id'],
  passed: boolean,
  passedMessage: string,
  reason: NonNullable<RepositoryPlatformCheck['reason']>,
  failedMessage: string,
  remediation: string,
): RepositoryPlatformCheck {
  return check(id, passed, passedMessage, reason, failedMessage, remediation);
}

async function runActiveProbes(root: string, backend: RepositoryPlatformBackend): Promise<ActiveProbeResult> {
  let temporary: string | undefined;
  let temporaryIdentity: BigIntStats | undefined;
  let result: ActiveProbeResult = failedActiveProbes();
  try {
    temporary = await mkdtemp(join(root, '.neottia-doctor-'));
    temporaryIdentity = await lstat(temporary, { bigint: true });
    if (!temporaryIdentity.isDirectory() || temporaryIdentity.isSymbolicLink()) {
      throw new Error('Private diagnostic area identity is invalid.');
    }
    const [hardLinks, identity] = await probeHardLinks(temporary);
    const atomicNoReplace = await probeAtomicNoReplace(temporary, backend);
    const fileDurability = await probeFileDurability(temporary, backend);
    const directoryDurability =
      process.platform === 'win32' ? true : await probeDirectoryDurability(temporary, backend);
    result = {
      temporaryArea: true,
      atomicNoReplace,
      hardLinks,
      stableIdentity: identity,
      fileDurability,
      directoryDurability,
    };
  } catch {
    result = failedActiveProbes();
  }
  if (temporary === undefined || temporaryIdentity === undefined) return result;
  const removed = await removeOwnedTemporaryArea(temporary, temporaryIdentity);
  return removed ? result : { ...result, temporaryArea: false };
}

function failedActiveProbes(): ActiveProbeResult {
  return {
    temporaryArea: false,
    atomicNoReplace: false,
    hardLinks: false,
    stableIdentity: false,
    fileDurability: false,
    directoryDurability: false,
  };
}

async function removeOwnedTemporaryArea(path: string, expected: BigIntStats): Promise<boolean> {
  try {
    const current = await lstat(path, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !sameBigIntIdentity(expected, current)) return false;
    await rm(path, { recursive: true, force: false });
    return await lstat(path).then(
      () => false,
      (error: unknown) => hasCode(error, 'ENOENT'),
    );
  } catch {
    return false;
  }
}

async function probeHardLinks(root: string): Promise<readonly [boolean, boolean]> {
  const source = join(root, 'link-source');
  const destination = join(root, 'link-destination');
  const bytes = Buffer.from('neottia-platform-diagnostic\n');
  await writeFile(source, bytes, { flag: 'wx', mode: 0o600 });
  try {
    await link(source, destination);
    const handle = await open(source, 'r');
    try {
      const [sourceState, destinationState, descriptorState, linkedBytes] = await Promise.all([
        lstat(source, { bigint: true }),
        lstat(destination, { bigint: true }),
        handle.stat({ bigint: true }),
        readFile(destination),
      ]);
      const hardLinks = sourceState.nlink >= 2n && destinationState.nlink >= 2n && linkedBytes.equals(bytes);
      const stableIdentity =
        sameBigIntIdentity(descriptorState, sourceState) && sameBigIntIdentity(descriptorState, destinationState);
      return [hardLinks, stableIdentity];
    } finally {
      await handle.close();
    }
  } catch {
    return [false, false];
  } finally {
    await unlink(destination).catch(() => undefined);
    await unlink(source).catch(() => undefined);
  }
}

async function probeAtomicNoReplace(root: string, backend: RepositoryPlatformBackend): Promise<boolean> {
  const source = join(root, 'publication-source');
  const destination = join(root, 'publication-destination');
  const sourceBytes = Buffer.from('source\n');
  const destinationBytes = Buffer.from('destination\n');
  await writeFile(source, sourceBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(destination, destinationBytes, { flag: 'wx', mode: 0o600 });
  let refused = false;
  try {
    backend.publication.renameNoReplace(source, destination);
  } catch (error: unknown) {
    refused = hasCode(error, 'EEXIST');
  }
  if (!refused) return false;
  if (!(await readFile(source)).equals(sourceBytes) || !(await readFile(destination)).equals(destinationBytes))
    return false;
  await unlink(destination);
  backend.publication.renameNoReplace(source, destination);
  const published = await readFile(destination);
  const sourceMissing = await lstat(source).then(
    () => false,
    (error: unknown) => hasCode(error, 'ENOENT'),
  );
  return sourceMissing && published.equals(sourceBytes);
}

async function probeFileDurability(root: string, backend: RepositoryPlatformBackend): Promise<boolean> {
  const path = join(root, 'durability-file');
  await writeFile(path, 'durability\n', { flag: 'wx', mode: 0o600 });
  const handle = await open(path, process.platform === 'win32' ? 'r+' : 'r');
  try {
    backend.durability.syncDescriptor(handle.fd);
    return true;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

async function probeDirectoryDurability(root: string, backend: RepositoryPlatformBackend): Promise<boolean> {
  const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    backend.durability.syncDescriptor(handle.fd);
    return true;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

function sameBigIntIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function durabilityModel(backend: RepositoryPlatformBackend | undefined): string | null {
  if (backend === undefined) return null;
  if (backend.platform === 'darwin') return 'F_FULLFSYNC for managed files and directories';
  if (backend.platform === 'win32') return 'fsyncSync for managed files and NTFS journaling for namespace mutations';
  return 'fsync for managed files and directories';
}
