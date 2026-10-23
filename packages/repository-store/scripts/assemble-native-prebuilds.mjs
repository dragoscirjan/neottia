import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NativePrebuildIntegrityError,
  assertSigstoreCertificateOids,
  certifiedTuples,
  createManifest,
  nativeMetadataName,
  readPackageVersion,
  sha256,
  tupleKey,
  validateManifestArtifact,
  writeJson,
} from './native-prebuild.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export async function assembleNativePrebuilds({
  root = packageRoot,
  inputDirectory,
  allowPartial = false,
  verifyBundle = verifySigstoreBundle,
} = {}) {
  if (inputDirectory === undefined) throw new Error('A native prebuild input directory is required.');
  const input = resolve(inputDirectory);
  const packageVersion = readPackageVersion(root);
  const metadataFiles = readdirSync(input)
    .filter((name) => name.endsWith('.metadata.json'))
    .sort();
  const artifacts = [];
  let sourceCommit;

  for (const metadataFile of metadataFiles) {
    const artifact = readMetadata(join(input, metadataFile));
    const provisionalManifest = createManifest(packageVersion, artifact.sourceCommit, [artifact]);
    validateManifestArtifact(provisionalManifest, artifact.platform, artifact.architecture);
    if (
      JSON.stringify(artifact.signature) !== JSON.stringify(provisionalManifest.signature) ||
      metadataFile !== nativeMetadataName(packageVersion, artifact.platform, artifact.architecture)
    )
      throw new NativePrebuildIntegrityError(`Native prebuild metadata ${metadataFile} is not deterministic.`);
    if (sourceCommit === undefined) sourceCommit = artifact.sourceCommit;
    if (sourceCommit !== artifact.sourceCommit)
      throw new NativePrebuildIntegrityError('Native prebuilds do not share one source commit.');
    const binaryPath = join(input, artifact.name);
    const bundlePath = join(input, artifact.bundle);
    const attestationPath = join(input, artifact.attestation);
    if (!existsSync(binaryPath) || !existsSync(bundlePath) || (!allowPartial && !existsSync(attestationPath)))
      throw new NativePrebuildIntegrityError(`Native prebuild ${artifact.name} is incomplete.`);
    const binary = readFileSync(binaryPath);
    if (binary.byteLength !== artifact.size || sha256(binary) !== artifact.sha256)
      throw new NativePrebuildIntegrityError(`Native prebuild ${artifact.name} does not match its metadata.`);
    let bundle;
    try {
      bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
    } catch (error) {
      throw new NativePrebuildIntegrityError(`Native prebuild signature ${artifact.bundle} is malformed.`, {
        cause: error,
      });
    }
    await verifyBundle(bundle, binary, artifact);
    artifacts.push(artifact);
  }

  if (sourceCommit === undefined) throw new NativePrebuildIntegrityError('No native prebuild metadata was found.');
  const expectedKeys = certifiedTuples.map(({ platform, architecture }) => tupleKey(platform, architecture)).sort();
  const actualKeys = artifacts.map(({ platform, architecture }) => tupleKey(platform, architecture)).sort();
  if (!allowPartial && JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys))
    throw new NativePrebuildIntegrityError(
      `Native prebuild set is incomplete: expected ${expectedKeys.join(', ')}, received ${actualKeys.join(', ')}.`,
    );
  if (new Set(actualKeys).size !== actualKeys.length)
    throw new NativePrebuildIntegrityError('Native prebuild metadata contains a duplicate platform tuple.');

  const manifest = createManifest(packageVersion, sourceCommit, artifacts);
  for (const artifact of artifacts) validateManifestArtifact(manifest, artifact.platform, artifact.architecture);
  writeJson(join(root, 'native-prebuilds.json'), manifest);
  return manifest;
}

async function verifySigstoreBundle(bundle, binary, artifact) {
  try {
    const { verify } = await import('sigstore');
    const signer = await verify(bundle, binary, {
      certificateIssuer: artifact.signature.certificateIssuer,
      certificateIdentityURI: artifact.signature.certificateIdentityURI,
    });
    assertSigstoreCertificateOids(signer, {
      [artifact.signature.sourceDigestOid]: artifact.sourceCommit,
      [artifact.signature.runnerEnvironmentOid]: 'github-hosted',
    });
  } catch (error) {
    throw new NativePrebuildIntegrityError(`Native prebuild ${artifact.name} failed signature verification.`, {
      cause: error,
    });
  }
}

function readMetadata(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new NativePrebuildIntegrityError(`Native prebuild metadata ${path} is malformed.`, { cause: error });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new NativePrebuildIntegrityError(`Native prebuild metadata ${path} is invalid.`);
  return value;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await assembleNativePrebuilds({
      inputDirectory: option('--input'),
      allowPartial: process.argv.includes('--allow-partial'),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
