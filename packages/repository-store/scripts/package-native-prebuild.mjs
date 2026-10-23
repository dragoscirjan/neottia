import { appendFileSync, copyFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sign } from 'sigstore';
import {
  NATIVE_BINARY_RELATIVE_PATH,
  SIGSTORE_CERTIFICATE_IDENTITY,
  SIGSTORE_CERTIFICATE_ISSUER,
  SIGSTORE_RUNNER_ENVIRONMENT_OID,
  SIGSTORE_SOURCE_DIGEST_OID,
  nativeArtifactName,
  nativeAttestationName,
  nativeBundleName,
  nativeMetadataName,
  readPackageVersion,
  sha256,
  tupleKey,
  writeJson,
} from './native-prebuild.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export async function packageNativePrebuild({
  root = packageRoot,
  outputDirectory,
  platform = process.platform,
  architecture = process.arch,
  sourceCommit = process.env.GITHUB_SHA,
  signArtifact = true,
} = {}) {
  if (outputDirectory === undefined) throw new Error('A native prebuild output directory is required.');
  if (platform !== process.platform || architecture !== process.arch)
    throw new Error(
      `Refusing to label a ${tupleKey(process.platform, process.arch)} binary as ${tupleKey(platform, architecture)}.`,
    );
  if (typeof sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(sourceCommit))
    throw new Error('GITHUB_SHA must identify the release source commit.');

  const version = readPackageVersion(root);
  const source = join(root, NATIVE_BINARY_RELATIVE_PATH);
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The native addon build output is not a regular file.');
  const bytes = readFileSync(source);
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const name = nativeArtifactName(version, platform, architecture);
  const bundle = nativeBundleName(version, platform, architecture);
  const attestation = nativeAttestationName(version, platform, architecture);
  const metadata = nativeMetadataName(version, platform, architecture);
  copyFileSync(source, join(output, name));

  if (!signArtifact) throw new Error('Release native prebuilds must have a Sigstore signature.');
  const signatureBundle = await sign(bytes);
  writeFileSync(join(output, bundle), `${JSON.stringify(signatureBundle)}\n`, { flag: 'wx', mode: 0o600 });

  const record = {
    platform,
    architecture,
    name,
    bundle,
    attestation,
    sha256: sha256(bytes),
    size: bytes.byteLength,
    sourceCommit,
    signature: {
      format: 'sigstore-bundle-v0.3',
      certificateIssuer: SIGSTORE_CERTIFICATE_ISSUER,
      certificateIdentityURI: SIGSTORE_CERTIFICATE_IDENTITY,
      sourceDigestOid: SIGSTORE_SOURCE_DIGEST_OID,
      runnerEnvironmentOid: SIGSTORE_RUNNER_ENVIRONMENT_OID,
    },
  };
  writeJson(join(output, metadata), record);
  return record;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const artifact = await packageNativePrebuild({
      outputDirectory: option('--output'),
      platform: option('--platform') ?? process.platform,
      architecture: option('--architecture') ?? process.arch,
    });
    if (process.env.GITHUB_OUTPUT !== undefined)
      appendFileSync(process.env.GITHUB_OUTPUT, `asset-name=${artifact.name}\n`, 'utf8');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
