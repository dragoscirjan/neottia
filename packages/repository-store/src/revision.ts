import { createHash } from 'node:crypto';

/** SHA-256 revision over exact canonical bytes. */
export type ByteRevision = `sha256:${string}`;

/** Computes the optimistic revision used by canonical operations. */
export function computeByteRevision(bytes: Uint8Array): ByteRevision {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Checks the strict public revision representation. */
export function isByteRevision(value: unknown): value is ByteRevision {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}
