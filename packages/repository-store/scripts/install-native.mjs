import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativeFromSource } from './build-native.mjs';
import {
  GITHUB_REPOSITORY,
  NativePrebuildAvailabilityError,
  NativePrebuildIntegrityError,
  assertArtifactBytes,
  installVerifiedBinary,
  isCertifiedTuple,
  readNativeManifest,
  readPackageVersion,
  validateManifestArtifact,
} from './native-prebuild.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_BINARY_BYTES = 32 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

export async function installNative({
  root = packageRoot,
  platform = process.platform,
  architecture = process.arch,
  environment = process.env,
  fetchImplementation = globalThis.fetch,
  verifySignature = verifySigstoreSignature,
  buildFromSource = () => buildNativeFromSource({ root }),
  logger = console,
} = {}) {
  if (!isCertifiedTuple(platform, architecture)) return { status: 'unsupported' };
  if (environment.NEOTTIA_REPOSITORY_STORE_FORCE_SOURCE_BUILD === '1')
    return sourceFallback(buildFromSource, logger, 'source build was explicitly requested');

  const version = readPackageVersion(root);
  const manifest = readNativeManifest(root, version);
  if (manifest === undefined) return sourceFallback(buildFromSource, logger, 'prebuild manifest is unavailable');
  const artifact = validateManifestArtifact(manifest, platform, architecture);
  const baseUrl =
    environment.NEOTTIA_REPOSITORY_STORE_PREBUILD_BASE_URL ??
    `https://github.com/${GITHUB_REPOSITORY}/releases/download/${encodeURIComponent(manifest.releaseTag)}`;

  try {
    const [binary, bundleBytes] = await Promise.all([
      download(joinUrl(baseUrl, artifact.name), artifact.name, MAX_BINARY_BYTES, fetchImplementation),
      download(joinUrl(baseUrl, artifact.bundle), artifact.bundle, MAX_BUNDLE_BYTES, fetchImplementation),
    ]);
    assertArtifactBytes(binary, artifact);
    let bundle;
    try {
      bundle = JSON.parse(bundleBytes.toString('utf8'));
    } catch (error) {
      throw new NativePrebuildIntegrityError(`Native prebuild signature ${artifact.bundle} is malformed.`, {
        cause: error,
      });
    }
    try {
      await verifySignature(bundle, binary, manifest, artifact);
    } catch (error) {
      if (error instanceof NativePrebuildAvailabilityError || error instanceof NativePrebuildIntegrityError)
        throw error;
      throw new NativePrebuildIntegrityError(`Native prebuild ${artifact.name} failed signature verification.`, {
        cause: error,
      });
    }
    installVerifiedBinary(root, binary, artifact);
    logger.info?.(`@neottia/repository-store: installed verified native prebuild ${artifact.name}.`);
    return { status: 'verified-prebuilt', artifact: artifact.name };
  } catch (error) {
    if (error instanceof NativePrebuildIntegrityError) throw error;
    if (error instanceof NativePrebuildAvailabilityError) return sourceFallback(buildFromSource, logger, error.message);
    throw error;
  }
}

async function verifySigstoreSignature(bundle, binary, manifest, artifact) {
  let verify;
  try {
    ({ verify } = await import('sigstore'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND')
      throw new NativePrebuildAvailabilityError('The optional Sigstore verifier is unavailable.', { cause: error });
    throw new NativePrebuildIntegrityError('The Sigstore verifier could not be initialized.', { cause: error });
  }
  await verify(bundle, binary, {
    certificateIssuer: manifest.signature.certificateIssuer,
    certificateIdentityURI: manifest.signature.certificateIdentityURI,
    certificateOIDs: {
      [manifest.signature.sourceDigestOid]: artifact.sourceCommit,
      [manifest.signature.runnerEnvironmentOid]: 'github-hosted',
    },
  });
}

async function download(url, name, maximumBytes, fetchImplementation) {
  let response;
  try {
    response = await fetchImplementation(url, {
      headers: { accept: 'application/octet-stream' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new NativePrebuildAvailabilityError(`Native prebuild ${name} could not be downloaded.`, { cause: error });
  }
  if (!response.ok)
    throw new NativePrebuildAvailabilityError(
      `Native prebuild ${name} is unavailable (HTTP ${String(response.status)}).`,
    );
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    throw new NativePrebuildIntegrityError(`Native prebuild download ${name} exceeds its size limit.`);
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new NativePrebuildAvailabilityError(`Native prebuild ${name} download was interrupted.`, { cause: error });
  }
  if (bytes.byteLength > maximumBytes)
    throw new NativePrebuildIntegrityError(`Native prebuild download ${name} exceeds its size limit.`);
  return bytes;
}

function sourceFallback(buildFromSource, logger, reason) {
  try {
    buildFromSource();
    logger.info?.(`@neottia/repository-store: built the native backend from source because ${reason}.`);
    return { status: 'source-build' };
  } catch (error) {
    logger.warn?.(
      '@neottia/repository-store: native platform backend was not built; destructive filesystem mutations will fail with UNSUPPORTED_RUNTIME.',
      error,
    );
    return { status: 'unavailable' };
  }
}

function joinUrl(baseUrl, name) {
  return `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await installNative();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
