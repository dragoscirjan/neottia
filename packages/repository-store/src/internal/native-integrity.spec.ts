import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyNativeAddonIntegrity } from './native-integrity.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('native addon integrity', () => {
  it('accepts bytes that match a source-build receipt', () => {
    const { root, binaryPath } = fixture(Buffer.from('native-addon'));
    expect(verifyNativeAddonIntegrity(root)).toBe(binaryPath);
  });

  it('rejects a binary changed after its receipt was written', () => {
    const { root, binaryPath } = fixture(Buffer.from('native-addon'));
    writeFileSync(binaryPath, 'changed-addon');
    expect(() => verifyNativeAddonIntegrity(root)).toThrow('does not match its integrity receipt');
  });

  it('rejects a missing or malformed receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'neottia-native-integrity-'));
    temporaryRoots.push(root);
    const release = join(root, 'build', 'Release');
    mkdirSync(release, { recursive: true });
    writeFileSync(join(release, 'repository_store_native.node'), 'native-addon');
    writeFileSync(join(release, 'repository_store_native.integrity.json'), '{}\n');
    expect(() => verifyNativeAddonIntegrity(root)).toThrow('receipt is invalid');
  });
});

function fixture(bytes: Buffer): { root: string; binaryPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'neottia-native-integrity-'));
  temporaryRoots.push(root);
  const release = join(root, 'build', 'Release');
  mkdirSync(release, { recursive: true });
  const binaryPath = join(release, 'repository_store_native.node');
  writeFileSync(binaryPath, bytes);
  writeFileSync(
    join(release, 'repository_store_native.integrity.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      origin: 'source-build',
      algorithm: 'sha256',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
    })}\n`,
  );
  return { root, binaryPath };
}
