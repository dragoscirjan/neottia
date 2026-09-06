import { randomBytes } from 'node:crypto';

/**
 * Crockford base32 ULID utilities, ported from the harnessctl-v2 reference
 * implementation so memory record IDs keep the same format across projects.
 */

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_ULID_TIMESTAMP = 0xffff_ffff_ffff;

export type UlidEntropy = () => Uint8Array;

/** Creates a 26-character Crockford ULID with a millisecond timestamp prefix. */
export function createUlid(timestamp = Date.now(), entropy: UlidEntropy = () => randomBytes(10)): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > MAX_ULID_TIMESTAMP)
    throw new RangeError('ULID timestamp must be an integer in the unsigned 48-bit range');
  const bytes = entropy();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 10)
    throw new RangeError('ULID entropy must contain exactly 10 bytes');

  let time = BigInt(timestamp);
  let encodedTime = '';
  for (let index = 0; index < 10; index += 1) {
    encodedTime = CROCKFORD[Number(time & 31n)] + encodedTime;
    time >>= 5n;
  }
  let randomness = 0n;
  for (const byte of bytes) randomness = (randomness << 8n) | BigInt(byte);
  let encodedRandom = '';
  for (let index = 0; index < 16; index += 1) {
    encodedRandom = CROCKFORD[Number(randomness & 31n)] + encodedRandom;
    randomness >>= 5n;
  }
  return encodedTime + encodedRandom;
}

/** Checks whether a value matches the Crockford ULID shape. */
export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
