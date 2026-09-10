import { randomBytes } from 'node:crypto';
import { IssueError } from './errors.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Newly allocated issue identifiers always end in an uppercase Crockford ULID. */
export const ULID_PATTERN = '[0-9A-HJKMNP-TV-Z]{26}';

/** Validates a portable prefix that cannot influence path traversal. */
export function validateIssuePrefix(prefix: string): string {
  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(prefix))
    throw new IssueError(
      'Issue prefix must start with a lowercase letter and contain only lowercase letters, digits, or hyphens.',
      'configuration',
      'PREFIX_INVALID',
    );
  return prefix;
}

/** Accepts current ULIDs and legacy decimal suffixes under the configured prefix. */
export function issueIdPattern(prefix: string): RegExp {
  return new RegExp(`^(?:${escapeRegExp(validateIssuePrefix(prefix))}(?:${ULID_PATTERN}|[0-9]{5,})|[0-9]{5,})$`, 'u');
}

/** Generates a time-sortable ULID without introducing a package dependency. */
export function createUlid(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff)
    throw new IssueError('ULID timestamp is outside the 48-bit range.');
  let time = BigInt(now);
  let encodedTime = '';
  for (let index = 0; index < 10; index++) {
    encodedTime = CROCKFORD[Number(time & 31n)] + encodedTime;
    time >>= 5n;
  }
  const entropy = randomBytes(16);
  let encodedRandom = '';
  let accumulator = 0;
  let bits = 0;
  for (const byte of entropy) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5 && encodedRandom.length < 16) {
      bits -= 5;
      encodedRandom += CROCKFORD[(accumulator >>> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  return `${encodedTime}${encodedRandom}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
