import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { assembleNativePrebuilds } from './assemble-native-prebuilds.mjs';
import { installNative } from './install-native.mjs';
import {
  NativePrebuildAvailabilityError,
  NativePrebuildIntegrityError,
  SIGSTORE_CERTIFICATE_IDENTITY,
  SIGSTORE_CERTIFICATE_ISSUER,
  SIGSTORE_RUNNER_ENVIRONMENT_OID,
  SIGSTORE_SOURCE_DIGEST_OID,
  assertSigstoreCertificateOids,
  certifiedTuples,
  createManifest,
  nativeArtifactName,
  nativeAttestationName,
  nativeBundleName,
  nativeMetadataName,
  sha256,
  writeJson,
} from './native-prebuild.mjs';

const roots = [];
const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
const bytes = Buffer.from('signed-native-addon');
const logger = { info() {}, warn() {} };

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('native prebuild installer', () => {
  it('installs a prebuild only after signature, size, and digest verification', async () => {
    const fixture = createFixture();
    let verified = false;
    const result = await installNative({
      root: fixture.root,
      platform: 'linux',
      architecture: 'x64',
      fetchImplementation: fixture.fetch,
      verifySignature: async (_bundle, candidate, _manifest, artifact) => {
        assert.deepEqual(candidate, bytes);
        assert.equal(artifact.sourceCommit, sourceCommit);
        verified = true;
      },
      buildFromSource: () => assert.fail('source fallback must not run'),
      logger,
    });
    assert.equal(result.status, 'verified-prebuilt');
    assert.equal(verified, true);
    assert.deepEqual(readFileSync(join(fixture.root, 'build', 'Release', 'repository_store_native.node')), bytes);
    const receipt = JSON.parse(
      readFileSync(join(fixture.root, 'build', 'Release', 'repository_store_native.integrity.json'), 'utf8'),
    );
    assert.equal(receipt.origin, 'verified-prebuilt');
  });

  it('uses source fallback when the asset is missing', async () => {
    const fixture = createFixture({ status: 404 });
    let builds = 0;
    const result = await installNative({
      root: fixture.root,
      platform: 'linux',
      architecture: 'x64',
      fetchImplementation: fixture.fetch,
      buildFromSource: () => builds++,
      logger,
    });
    assert.equal(result.status, 'source-build');
    assert.equal(builds, 1);
  });

  it('uses source fallback after a network failure', async () => {
    const fixture = createFixture();
    let builds = 0;
    const result = await installNative({
      root: fixture.root,
      platform: 'linux',
      architecture: 'x64',
      fetchImplementation: async () => {
        throw new Error('offline');
      },
      buildFromSource: () => builds++,
      logger,
    });
    assert.equal(result.status, 'source-build');
    assert.equal(builds, 1);
  });

  it('uses source fallback when the optional signature verifier is unavailable', async () => {
    const fixture = createFixture();
    let builds = 0;
    const result = await installNative({
      root: fixture.root,
      platform: 'linux',
      architecture: 'x64',
      fetchImplementation: fixture.fetch,
      verifySignature: async () => {
        throw new NativePrebuildAvailabilityError('Sigstore is unavailable.');
      },
      buildFromSource: () => builds++,
      logger,
    });
    assert.equal(result.status, 'source-build');
    assert.equal(builds, 1);
  });

  it('fails closed and leaves no binary after a checksum mismatch', async () => {
    const fixture = createFixture({ artifactBytes: Buffer.from('altered') });
    await assert.rejects(
      installNative({
        root: fixture.root,
        platform: 'linux',
        architecture: 'x64',
        fetchImplementation: fixture.fetch,
        verifySignature: async () => {},
        buildFromSource: () => assert.fail('invalid artifacts must not trigger fallback'),
        logger,
      }),
      NativePrebuildIntegrityError,
    );
    assert.equal(existsSync(join(fixture.root, 'build', 'Release', 'repository_store_native.node')), false);
  });

  it('fails closed when signature verification fails', async () => {
    const fixture = createFixture();
    await assert.rejects(
      installNative({
        root: fixture.root,
        platform: 'linux',
        architecture: 'x64',
        fetchImplementation: fixture.fetch,
        verifySignature: async () => {
          throw new Error('untrusted signer');
        },
        buildFromSource: () => assert.fail('invalid signatures must not trigger fallback'),
        logger,
      }),
      /failed signature verification/,
    );
  });

  it('rejects malformed metadata before downloading', async () => {
    const fixture = createFixture();
    const manifestPath = join(fixture.root, 'native-prebuilds.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts[0].name = '../native.node';
    writeJson(manifestPath, manifest);
    await assert.rejects(
      installNative({
        root: fixture.root,
        platform: 'linux',
        architecture: 'x64',
        fetchImplementation: async () => assert.fail('malformed metadata must not reach the network'),
        logger,
      }),
      /metadata is invalid/,
    );
  });

  it('does nothing for an unsupported tuple', async () => {
    const fixture = createFixture();
    const result = await installNative({
      root: fixture.root,
      platform: 'aix',
      architecture: 'ppc64',
      fetchImplementation: async () => assert.fail('unsupported tuples must not reach the network'),
      buildFromSource: () => assert.fail('unsupported tuples must not build'),
      logger,
    });
    assert.equal(result.status, 'unsupported');
  });

  it('honors explicit source fallback without reaching the network', async () => {
    const fixture = createFixture();
    let builds = 0;
    const result = await installNative({
      root: fixture.root,
      platform: 'linux',
      architecture: 'x64',
      environment: { NEOTTIA_REPOSITORY_STORE_FORCE_SOURCE_BUILD: '1' },
      fetchImplementation: async () => assert.fail('forced source builds must not reach the network'),
      buildFromSource: () => builds++,
      logger,
    });
    assert.equal(result.status, 'source-build');
    assert.equal(builds, 1);
  });

  it('checks DER-encoded source and runner certificate claims', () => {
    const oid = (name, value) => ({
      oid: { id: name.split('.').map(Number) },
      value: Buffer.concat([Buffer.from([0x0c, Buffer.byteLength(value)]), Buffer.from(value)]),
    });
    const signer = {
      identity: {
        oids: [oid(SIGSTORE_SOURCE_DIGEST_OID, sourceCommit), oid(SIGSTORE_RUNNER_ENVIRONMENT_OID, 'github-hosted')],
      },
    };
    assert.doesNotThrow(() =>
      assertSigstoreCertificateOids(signer, {
        [SIGSTORE_SOURCE_DIGEST_OID]: sourceCommit,
        [SIGSTORE_RUNNER_ENVIRONMENT_OID]: 'github-hosted',
      }),
    );
    assert.throws(
      () => assertSigstoreCertificateOids(signer, { [SIGSTORE_SOURCE_DIGEST_OID]: 'f'.repeat(40) }),
      NativePrebuildIntegrityError,
    );
    assert.throws(
      () => assertSigstoreCertificateOids({ identity: { oids: [] } }, { [SIGSTORE_SOURCE_DIGEST_OID]: sourceCommit }),
      NativePrebuildIntegrityError,
    );
    assert.throws(
      () =>
        assertSigstoreCertificateOids(
          {
            identity: {
              oids: [
                {
                  oid: { id: SIGSTORE_SOURCE_DIGEST_OID.split('.').map(Number) },
                  value: Buffer.from(sourceCommit),
                },
              ],
            },
          },
          { [SIGSTORE_SOURCE_DIGEST_OID]: sourceCommit },
        ),
      NativePrebuildIntegrityError,
    );
  });

  it('assembles one complete deterministic release manifest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-native-manifest-'));
    roots.push(root);
    const input = join(root, 'input');
    mkdirSync(input);
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({ name: '@neottia/repository-store', version: '1.2.3' })}\n`,
    );
    for (const tuple of certifiedTuples) {
      const artifact = createArtifact('1.2.3', tuple.platform, tuple.architecture);
      writeFileSync(join(input, artifact.name), bytes);
      writeFileSync(join(input, artifact.bundle), '{}\n');
      writeFileSync(join(input, artifact.attestation), '{}\n');
      writeJson(join(input, nativeMetadataName('1.2.3', tuple.platform, tuple.architecture)), artifact);
    }
    let verified = 0;
    const manifest = await assembleNativePrebuilds({
      root,
      inputDirectory: input,
      verifyBundle: async () => verified++,
    });
    assert.equal(manifest.artifacts.length, certifiedTuples.length);
    assert.equal(verified, certifiedTuples.length);
    assert.equal(manifest.releaseTag, '@neottia/repository-store@1.2.3');
  });
});

function createArtifact(version, platform, architecture) {
  return {
    platform,
    architecture,
    name: nativeArtifactName(version, platform, architecture),
    bundle: nativeBundleName(version, platform, architecture),
    attestation: nativeAttestationName(version, platform, architecture),
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
}

function createFixture({ status = 200, artifactBytes = bytes } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'neottia-native-installer-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: '@neottia/repository-store', version: '1.2.3' })}\n`,
  );
  const artifact = createArtifact('1.2.3', 'linux', 'x64');
  writeJson(join(root, 'native-prebuilds.json'), createManifest('1.2.3', sourceCommit, [artifact]));
  const responses = new Map([
    [artifact.name, artifactBytes],
    [artifact.bundle, Buffer.from('{}')],
  ]);
  return {
    root,
    fetch: async (url) => {
      if (status !== 200) return new Response('', { status });
      const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
      const body = responses.get(name);
      return body === undefined ? new Response('', { status: 404 }) : new Response(body, { status: 200 });
    },
  };
}
