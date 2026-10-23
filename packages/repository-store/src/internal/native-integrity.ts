import { createHash, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_RECEIPT_BYTES = 16 * 1024;
const MAX_NATIVE_ADDON_BYTES = 32 * 1024 * 1024;

interface NativeIntegrityReceipt {
  readonly schemaVersion: 1;
  readonly algorithm: 'sha256';
  readonly sha256: string;
  readonly size: number;
  readonly origin: 'verified-prebuilt' | 'source-build';
}

/** Rejects an addon whose bytes changed after installation or source compilation. */
export function verifyNativeAddonIntegrity(packageRoot: string): string {
  const binaryPath = join(packageRoot, 'build', 'Release', 'repository_store_native.node');
  const receiptPath = join(packageRoot, 'build', 'Release', 'repository_store_native.integrity.json');
  const binaryStat = lstatSync(binaryPath);
  const receiptStat = lstatSync(receiptPath);
  if (!binaryStat.isFile() || binaryStat.isSymbolicLink() || !receiptStat.isFile() || receiptStat.isSymbolicLink())
    throw new Error('Native addon integrity files must be regular files.');
  if (binaryStat.size <= 0 || binaryStat.size > MAX_NATIVE_ADDON_BYTES || receiptStat.size > MAX_RECEIPT_BYTES)
    throw new Error('Native addon integrity files exceed their size limits.');

  const receipt = parseReceipt(readFileSync(receiptPath, 'utf8'));
  if (receipt.size !== binaryStat.size) throw new Error('Native addon size does not match its integrity receipt.');
  const actual = createHash('sha256').update(readFileSync(binaryPath)).digest();
  const expected = Buffer.from(receipt.sha256, 'hex');
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected))
    throw new Error('Native addon SHA-256 does not match its integrity receipt.');
  return binaryPath;
}

function parseReceipt(source: string): NativeIntegrityReceipt {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error('Native addon integrity receipt is malformed.', { cause: error });
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('algorithm' in value) ||
    value.algorithm !== 'sha256' ||
    !('sha256' in value) ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.sha256) ||
    !('size' in value) ||
    !Number.isSafeInteger(value.size) ||
    Number(value.size) <= 0 ||
    !('origin' in value) ||
    (value.origin !== 'verified-prebuilt' && value.origin !== 'source-build')
  )
    throw new Error('Native addon integrity receipt is invalid.');
  return value as NativeIntegrityReceipt;
}
