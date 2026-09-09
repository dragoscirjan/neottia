import { randomBytes } from 'node:crypto';
import { DesignDocsError } from './errors.js';

export const DOCUMENT_ID_PREFIX = 'doc-';
export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
// Legacy decimal identities were historically bounded by the 128-character ID field.
export const DOCUMENT_ID_PATTERN = /^doc-(?:[0-9]{5,120}|[0-7][0-9A-HJKMNP-TV-Z]{25})$/u;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Creates a timestamp-sortable Crockford ULID without an ambient package. */
export function createDocumentId(timestamp = Date.now()): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffffffff)
    throw new DesignDocsError('schema', 'ID_TIMESTAMP_INVALID', 'Document ID timestamp is outside ULID range.');
  let time = BigInt(timestamp);
  let encodedTime = '';
  for (let index = 0; index < 10; index++) {
    encodedTime = CROCKFORD[Number(time & 31n)] + encodedTime;
    time >>= 5n;
  }
  const entropy = randomBytes(10);
  let random = BigInt(`0x${entropy.toString('hex')}`);
  let encodedRandom = '';
  for (let index = 0; index < 16; index++) {
    encodedRandom = CROCKFORD[Number(random & 31n)] + encodedRandom;
    random >>= 5n;
  }
  return `${DOCUMENT_ID_PREFIX}${encodedTime}${encodedRandom}`;
}

/** Accepts stable ULID IDs and read/import-only legacy decimal identities. */
export function assertDocumentId(value: string): void {
  if (!DOCUMENT_ID_PATTERN.test(value))
    throw new DesignDocsError('schema', 'DOCUMENT_ID_INVALID', `Invalid document ID: ${value}`);
}
