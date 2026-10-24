import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const PACKAGE_NAME = '@neottia/repository-store';
export const MANIFEST_SCHEMA_VERSION = 1;
export const RECEIPT_SCHEMA_VERSION = 1;
export const SIGSTORE_CERTIFICATE_ISSUER = 'https://token.actions.githubusercontent.com';
export const SIGSTORE_CERTIFICATE_IDENTITY =
  'https://github.com/dragoscirjan/neottia/.github/workflows/ci.yml@refs/heads/main';
export const SIGSTORE_SOURCE_DIGEST_OID = '1.3.6.1.4.1.57264.1.13';
export const SIGSTORE_RUNNER_ENVIRONMENT_OID = '1.3.6.1.4.1.57264.1.11';
export const GITHUB_REPOSITORY = 'dragoscirjan/neottia';
export const NATIVE_BINARY_RELATIVE_PATH = join('build', 'Release', 'repository_store_native.node');
export const NATIVE_RECEIPT_RELATIVE_PATH = join('build', 'Release', 'repository_store_native.integrity.json');

export const certifiedTuples = Object.freeze([
  Object.freeze({ platform: 'linux', architecture: 'x64' }),
  Object.freeze({ platform: 'linux', architecture: 'arm64' }),
  Object.freeze({ platform: 'darwin', architecture: 'x64' }),
  Object.freeze({ platform: 'darwin', architecture: 'arm64' }),
  Object.freeze({ platform: 'win32', architecture: 'x64' }),
  Object.freeze({ platform: 'freebsd', architecture: 'x64' }),
]);

export class NativePrebuildAvailabilityError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'NativePrebuildAvailabilityError';
  }
}

export class NativePrebuildIntegrityError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'NativePrebuildIntegrityError';
  }
}

export function assertSigstoreCertificateOids(signer, expectedOids) {
  const actualOids = signer?.identity?.oids;
  if (!Array.isArray(actualOids))
    throw new NativePrebuildIntegrityError('The Sigstore certificate contains no verifiable OID claims.');
  for (const [oid, expectedValue] of Object.entries(expectedOids)) {
    const claim = actualOids.find(
      (candidate) => candidate?.oid?.id?.join('.') === oid && Buffer.isBuffer(candidate.value),
    );
    const expected = encodeDerUtf8String(Buffer.from(expectedValue, 'utf8'));
    if (claim === undefined || !claim.value.equals(expected))
      throw new NativePrebuildIntegrityError(`The Sigstore certificate does not pin ${oid} to ${expectedValue}.`);
  }
}

export function sigstoreCertificateIdentityPattern(identity) {
  return `^${identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

export function tupleKey(platform, architecture) {
  return `${platform}-${architecture}`;
}

export function isCertifiedTuple(platform, architecture) {
  return certifiedTuples.some((tuple) => tuple.platform === platform && tuple.architecture === architecture);
}

export function releaseTag(version) {
  return `${PACKAGE_NAME}@${version}`;
}

export function nativeArtifactName(version, platform, architecture) {
  return `repository-store-native-v${version}-${platform}-${architecture}.node`;
}

export function nativeBundleName(version, platform, architecture) {
  return `${nativeArtifactName(version, platform, architecture)}.sigstore.json`;
}

export function nativeAttestationName(version, platform, architecture) {
  return `${nativeArtifactName(version, platform, architecture)}.intoto.jsonl`;
}

export function nativeMetadataName(version, platform, architecture) {
  return `${nativeArtifactName(version, platform, architecture)}.metadata.json`;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function readPackageVersion(packageRoot) {
  const packageJson = parseJson(readFileSync(join(packageRoot, 'package.json'), 'utf8'), 'package.json');
  if (packageJson.name !== PACKAGE_NAME || !isVersion(packageJson.version))
    throw new NativePrebuildIntegrityError('Repository Store package metadata is invalid.');
  return packageJson.version;
}

export function readNativeManifest(packageRoot, expectedVersion = readPackageVersion(packageRoot)) {
  let source;
  try {
    source = readFileSync(join(packageRoot, 'native-prebuilds.json'), 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
  const manifest = parseJson(source, 'native-prebuilds.json');
  validateManifestHeader(manifest, expectedVersion);
  if (!Array.isArray(manifest.artifacts))
    throw new NativePrebuildIntegrityError('Native prebuild manifest artifacts are invalid.');
  return manifest;
}

export function validateManifestArtifact(manifest, platform, architecture) {
  const artifact = manifest.artifacts.find(
    (candidate) => candidate?.platform === platform && candidate?.architecture === architecture,
  );
  if (artifact === undefined)
    throw new NativePrebuildIntegrityError(`Native prebuild manifest is missing ${tupleKey(platform, architecture)}.`);
  const expectedName = nativeArtifactName(manifest.packageVersion, platform, architecture);
  const expectedBundle = nativeBundleName(manifest.packageVersion, platform, architecture);
  const expectedAttestation = nativeAttestationName(manifest.packageVersion, platform, architecture);
  if (
    artifact.name !== expectedName ||
    artifact.bundle !== expectedBundle ||
    artifact.attestation !== expectedAttestation ||
    !isSha256(artifact.sha256) ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0 ||
    artifact.sourceCommit !== manifest.sourceCommit
  )
    throw new NativePrebuildIntegrityError(
      `Native prebuild metadata is invalid for ${tupleKey(platform, architecture)}.`,
    );
  return artifact;
}

export function createManifest(packageVersion, sourceCommit, artifacts) {
  if (!isVersion(packageVersion) || !isCommit(sourceCommit))
    throw new NativePrebuildIntegrityError('Cannot create a native prebuild manifest with invalid release metadata.');
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    packageName: PACKAGE_NAME,
    packageVersion,
    releaseTag: releaseTag(packageVersion),
    sourceCommit,
    signature: {
      format: 'sigstore-bundle-v0.3',
      certificateIssuer: SIGSTORE_CERTIFICATE_ISSUER,
      certificateIdentityURI: SIGSTORE_CERTIFICATE_IDENTITY,
      sourceDigestOid: SIGSTORE_SOURCE_DIGEST_OID,
      runnerEnvironmentOid: SIGSTORE_RUNNER_ENVIRONMENT_OID,
    },
    artifacts: [...artifacts].sort((left, right) =>
      tupleKey(left.platform, left.architecture).localeCompare(tupleKey(right.platform, right.architecture)),
    ),
  };
}

export function writeIntegrityReceipt(packageRoot, origin, details = {}) {
  const binaryPath = join(packageRoot, NATIVE_BINARY_RELATIVE_PATH);
  const stat = lstatSync(binaryPath);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new NativePrebuildIntegrityError('Native addon output is not a regular file.');
  const bytes = readFileSync(binaryPath);
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    origin,
    algorithm: 'sha256',
    sha256: sha256(bytes),
    size: bytes.byteLength,
    ...details,
  };
  atomicWriteJson(join(packageRoot, NATIVE_RECEIPT_RELATIVE_PATH), receipt);
  return receipt;
}

export function installVerifiedBinary(packageRoot, bytes, artifact) {
  if (bytes.byteLength !== artifact.size || sha256(bytes) !== artifact.sha256)
    throw new NativePrebuildIntegrityError('Verified native prebuild bytes do not match their manifest.');
  const binaryPath = join(packageRoot, NATIVE_BINARY_RELATIVE_PATH);
  const temporary = `${binaryPath}.${randomUUID()}.tmp`;
  mkdirSync(dirname(binaryPath), { recursive: true });
  try {
    writeSynchronizedFile(temporary, bytes, 0o600);
    renameSync(temporary, binaryPath);
    return writeIntegrityReceipt(packageRoot, 'verified-prebuilt', {
      artifact: artifact.name,
      sourceCommit: artifact.sourceCommit,
      signature: 'sigstore',
    });
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function writeJson(path, value) {
  atomicWriteJson(path, value);
}

export function assertArtifactBytes(bytes, artifact) {
  if (bytes.byteLength !== artifact.size)
    throw new NativePrebuildIntegrityError(`Native prebuild ${artifact.name} has an unexpected size.`);
  if (sha256(bytes) !== artifact.sha256)
    throw new NativePrebuildIntegrityError(`Native prebuild ${artifact.name} failed its SHA-256 check.`);
}

function validateManifestHeader(manifest, expectedVersion) {
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    manifest.packageName !== PACKAGE_NAME ||
    manifest.packageVersion !== expectedVersion ||
    manifest.releaseTag !== releaseTag(expectedVersion) ||
    !isCommit(manifest.sourceCommit) ||
    !isRecord(manifest.signature) ||
    manifest.signature.format !== 'sigstore-bundle-v0.3' ||
    manifest.signature.certificateIssuer !== SIGSTORE_CERTIFICATE_ISSUER ||
    manifest.signature.certificateIdentityURI !== SIGSTORE_CERTIFICATE_IDENTITY ||
    manifest.signature.sourceDigestOid !== SIGSTORE_SOURCE_DIGEST_OID ||
    manifest.signature.runnerEnvironmentOid !== SIGSTORE_RUNNER_ENVIRONMENT_OID
  )
    throw new NativePrebuildIntegrityError('Native prebuild manifest header is invalid.');
}

function atomicWriteJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeSynchronizedFile(temporary, Buffer.from(`${JSON.stringify(value, null, 2)}\n`), 0o600);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function writeSynchronizedFile(path, bytes, mode) {
  const descriptor = openSync(path, 'wx', mode);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function parseJson(source, label) {
  try {
    const parsed = JSON.parse(source);
    if (!isRecord(parsed)) throw new Error('expected an object');
    return parsed;
  } catch (error) {
    throw new NativePrebuildIntegrityError(`${label} is not valid JSON metadata.`, { cause: error });
  }
}

function encodeDerUtf8String(value) {
  if (value.byteLength >= 128)
    throw new NativePrebuildIntegrityError('The Sigstore certificate OID claim is too large.');
  return Buffer.concat([Buffer.from([0x0c, value.byteLength]), value]);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function isCommit(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function hasCode(error, code) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
