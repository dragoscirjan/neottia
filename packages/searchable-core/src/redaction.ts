import { Buffer } from 'node:buffer';
import type { SearchableConfig } from './config.js';
import { SearchableError } from './errors.js';

const URL_PATTERN = /https?:\/\/[^\s<>'"`]+/giu;
const MAX_DETAIL_DEPTH = 16;
const MAX_DETAIL_ENTRIES = 1_024;
const MAX_DETAIL_STRING_CHARS = 16_384;
type JsonSafeValue = null | boolean | number | string | JsonSafeValue[] | { readonly [key: string]: JsonSafeValue };
interface TraversalState {
  readonly seen: WeakSet<object>;
  remaining: number;
}

/** Removes URL userinfo, query parameters, and fragments from diagnostics. */
export function redactDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '<redacted-url>';
  }
}

/** Sanitizes arbitrary diagnostic text using all resolved provider credentials. */
export function redactDiagnosticText(value: string, credentials: readonly string[] = []): string {
  let safe = value.replace(URL_PATTERN, (url) => redactDiagnosticUrl(url));
  for (const credential of credentials) {
    if (!credential) continue;
    const encodedPattern = encodedCredentialPattern(credential);
    safe = encodedPattern ? safe.replace(encodedPattern, '<redacted>') : safe.replaceAll(credential, '<redacted>');
  }
  return safe;
}

/** Matches a credential with any UTF-8 character either raw or percent-encoded. */
function encodedCredentialPattern(credential: string): RegExp | undefined {
  const pattern = [...credential]
    .map((character) => {
      const raw = character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const encoded = [...Buffer.from(character, 'utf8')]
        .map((byte) => {
          const hex = byte.toString(16).toUpperCase().padStart(2, '0');
          const caseInsensitiveHex = [...hex]
            .map((digit) => (/[A-F]/u.test(digit) ? `[${digit}${digit.toLowerCase()}]` : digit))
            .join('');
          return `%${caseInsensitiveHex}`;
        })
        .join('');
      return `(?:${raw}|${encoded})`;
    })
    .join('');
  try {
    return new RegExp(pattern, 'gu');
  } catch {
    // Literal replacement remains fail-safe for malformed credential text.
    return undefined;
  }
}

/** Returns the resolved secrets that must never cross the service boundary. */
export function searchableCredentialValues(config: SearchableConfig): readonly string[] {
  return Object.values(config.search.credentials).filter((value): value is string => Boolean(value));
}

/** Converts any service exception without allowing hostile details to replace it. */
export function asRedactedSearchableError(error: unknown, config: SearchableConfig): SearchableError {
  try {
    const credentials = searchableCredentialValues(config);
    if (error instanceof SearchableError)
      return new SearchableError(
        error.category,
        redactDiagnosticText(error.code, credentials),
        redactDiagnosticText(error.message, credentials),
        error.paths.map((path) => redactDiagnosticText(path, credentials)),
        error.details === undefined
          ? undefined
          : redactRecord(error.details, credentials, {
              seen: new WeakSet(),
              remaining: MAX_DETAIL_ENTRIES,
            }),
      );
    if (isCancellation(error))
      return new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable operation was cancelled.');
    const message = error instanceof Error ? error.message : String(error);
    return new SearchableError(
      'service',
      'SERVICE_FAILED',
      redactDiagnosticText(`Searchable service failed: ${message}`, credentials),
    );
  } catch {
    // Never inspect or echo a replacement failure raised while traversing hostile values.
    return genericServiceError();
  }
}

/** Returns the fixed fail-safe used when diagnostic inspection itself is unsafe. */
function genericServiceError(): SearchableError {
  return new SearchableError('service', 'SERVICE_FAILED', 'Searchable service failed.');
}

/** Redacts data descriptors without invoking accessors or collapsing sanitized keys. */
function redactRecord(
  value: Readonly<Record<string, unknown>>,
  credentials: readonly string[],
  state: TraversalState,
  depth = 0,
): Readonly<Record<string, JsonSafeValue>> {
  if (state.seen.has(value)) return { circular: '<circular>' };
  if (depth >= MAX_DETAIL_DEPTH || state.remaining <= 0) return { truncated: '<truncated>' };
  state.seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<[string, JsonSafeValue]> = [];
  const used = new Set<string>();
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue;
    if (state.remaining <= 0) {
      entries.push(['truncated', '<truncated>']);
      break;
    }
    state.remaining -= 1;
    const base = redactDetailText(key, credentials) || '<redacted-key>';
    let unique = base;
    for (let suffix = 2; used.has(unique); suffix += 1) unique = `${base}#${suffix}`;
    used.add(unique);
    entries.push([
      unique,
      'value' in descriptor ? redactUnknown(descriptor.value, credentials, state, depth + 1) : '<accessor>',
    ]);
  }
  state.seen.delete(value);
  return Object.fromEntries(entries);
}

/** Recursively produces bounded JSON-safe values without using object iterators. */
function redactUnknown(
  value: unknown,
  credentials: readonly string[],
  state: TraversalState,
  depth: number,
): JsonSafeValue {
  if (typeof value === 'string') return redactDetailText(value, credentials);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return redactDetailText(value.toString(), credentials);
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return null;
  if (state.seen.has(value)) return '<circular>';
  if (depth >= MAX_DETAIL_DEPTH || state.remaining <= 0) return '<truncated>';
  if (Array.isArray(value)) return redactArray(value, credentials, state, depth);
  return redactRecord(value as Record<string, unknown>, credentials, state, depth);
}

/** Reads ordinary array data descriptors without invoking indexed accessors. */
function redactArray(
  value: readonly unknown[],
  credentials: readonly string[],
  state: TraversalState,
  depth: number,
): JsonSafeValue[] {
  state.seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
  const declaredLength = descriptors['length']?.value;
  const length = typeof declaredLength === 'number' ? Math.min(declaredLength, state.remaining) : 0;
  const result: JsonSafeValue[] = [];
  for (let index = 0; index < length; index += 1) {
    state.remaining -= 1;
    const descriptor = descriptors[String(index)];
    result.push(
      descriptor && 'value' in descriptor
        ? redactUnknown(descriptor.value, credentials, state, depth + 1)
        : descriptor
          ? '<accessor>'
          : null,
    );
  }
  if (declaredLength > length) result.push('<truncated>');
  state.seen.delete(value);
  return result;
}

/** Redacts then bounds detail text so credentials cannot straddle truncation. */
function redactDetailText(value: string, credentials: readonly string[]): string {
  return redactDiagnosticText(value, credentials).slice(0, MAX_DETAIL_STRING_CHARS);
}

/** Recognizes both DOM-style and conventional abort failures. */
function isCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
