import { RepositoryStoreError } from '@neottia/repository-store';

/** Stable error categories exposed by every Design Docs delivery surface. */
export type DesignDocsErrorCategory =
  | 'configuration'
  | 'disabled'
  | 'path_safety'
  | 'parse_safety'
  | 'schema'
  | 'canonical_form'
  | 'identity_ambiguity'
  | 'resource_limit'
  | 'stale_revision'
  | 'lifecycle'
  | 'filesystem_durability'
  | 'synchronization'
  | 'cache';

/** Typed domain failure which retains machine-readable context across adapters. */
export class DesignDocsError extends Error {
  public readonly retryable: boolean;
  public readonly details?: Readonly<Record<string, unknown>>;

  public constructor(
    public readonly category: DesignDocsErrorCategory,
    public readonly code: string,
    message: string,
    public readonly paths: readonly string[] = [],
    details?: Readonly<Record<string, unknown>>,
    options: ErrorOptions & { readonly retryable?: boolean } = {},
  ) {
    super(message, options);
    this.name = 'DesignDocsError';
    this.retryable = options.retryable ?? false;
    this.details = details === undefined ? undefined : boundedDetails(details);
  }
}

/** Maps repository-store failures without flattening their stable code. */
export function asDesignDocsError(error: unknown): DesignDocsError {
  if (error instanceof DesignDocsError) return error;
  if (error instanceof RepositoryStoreError) {
    const category: DesignDocsErrorCategory =
      error.category === 'path_safety'
        ? 'path_safety'
        : error.category === 'resource_limit'
          ? 'resource_limit'
          : error.category === 'stale_revision'
            ? 'stale_revision'
            : error.category === 'cache_sync'
              ? 'cache'
              : error.category === 'config'
                ? 'configuration'
                : error.category === 'durability'
                  ? 'filesystem_durability'
                  : 'synchronization';
    return new DesignDocsError(category, error.code, error.message, [], error.evidence, {
      cause: error,
      retryable: error.retryable,
    });
  }
  return new DesignDocsError(
    'synchronization',
    'UNEXPECTED',
    error instanceof Error ? error.message : String(error),
    [],
    undefined,
    { cause: error },
  );
}

/** Produces the transport-neutral structured error object used by tool hosts. */
export function serializeDesignDocsError(error: unknown): {
  category: string;
  code: string;
  message: string;
  paths: readonly string[];
  retryable: boolean;
  details?: Readonly<Record<string, unknown>>;
} {
  const value = asDesignDocsError(error);
  return {
    category: value.category,
    code: value.code,
    message: value.message,
    paths: [...value.paths],
    retryable: value.retryable,
    ...(value.details === undefined ? {} : { details: value.details }),
  };
}

const DETAIL_STRING_BYTES = 1024;
const DETAIL_TOTAL_BYTES = 16 * 1024;
const DETAIL_ITEMS = 20;
const DETAIL_TOTAL_ITEMS = 500;
const DETAIL_DEPTH = 5;
const DETAIL_CONTENT_BYTES = DETAIL_TOTAL_BYTES - 64;
const skipped = Symbol('skipped');
type DiagnosticValue = string | number | boolean | null | DiagnosticValue[] | { [key: string]: DiagnosticValue };
interface DetailBudget {
  bytes: number;
  items: number;
  truncated: boolean;
}

/** Copies provider-controlled diagnostics into a bounded JSON-safe value. */
function boundedDetails(details: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const budget: DetailBudget = { bytes: 0, items: 0, truncated: false };
  const sanitized = sanitizeValue(details, budget, 0);
  const result = isPlainRecord(sanitized) ? sanitized : { value: sanitized === skipped ? '[truncated]' : sanitized };
  const bounded = budget.truncated ? { ...result, detailsTruncated: true } : result;
  // The accounting includes JSON framing; this assertion protects future sanitizer changes.
  if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > DETAIL_TOTAL_BYTES) return { detailsTruncated: true };
  return bounded;
}

function sanitizeValue(value: unknown, budget: DetailBudget, depth: number): DiagnosticValue | typeof skipped {
  if (depth >= DETAIL_DEPTH) {
    budget.truncated = true;
    return chargedPrimitive('[truncated]', budget);
  }
  if (value === null || typeof value === 'boolean') return chargedPrimitive(value, budget);
  if (typeof value === 'number') return chargedPrimitive(Number.isFinite(value) ? value : String(value), budget);
  if (typeof value === 'string') return chargedString(value, budget);
  if (Array.isArray(value)) {
    if (!charge(budget, 2)) return skipped;
    if (value.length > DETAIL_ITEMS) budget.truncated = true;
    const result: DiagnosticValue[] = [];
    for (const item of value.slice(0, DETAIL_ITEMS)) {
      if (!chargeItem(budget) || (result.length > 0 && !charge(budget, 1))) break;
      const sanitized = sanitizeValue(item, budget, depth + 1);
      if (sanitized === skipped) break;
      result.push(sanitized);
    }
    return result;
  }
  if (isPlainRecord(value)) {
    if (!charge(budget, 2)) return skipped;
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    if (entries.length > DETAIL_ITEMS) budget.truncated = true;
    const result: Record<string, DiagnosticValue> = {};
    for (const [key, item] of entries.slice(0, DETAIL_ITEMS)) {
      const framing = Buffer.byteLength(JSON.stringify(key), 'utf8') + 1 + (Object.keys(result).length > 0 ? 1 : 0);
      if (!chargeItem(budget) || !charge(budget, framing)) break;
      const sanitized = sanitizeValue(item, budget, depth + 1);
      if (sanitized === skipped) break;
      result[key] = sanitized;
    }
    return result;
  }
  return chargedString(String(value), budget);
}

function chargedPrimitive<T extends number | boolean | null | string>(
  value: T,
  budget: DetailBudget,
): T | typeof skipped {
  return charge(budget, Buffer.byteLength(JSON.stringify(value), 'utf8')) ? value : skipped;
}

function chargedString(value: string, budget: DetailBudget): string | typeof skipped {
  const suffix = '...';
  let output = value;
  if (Buffer.byteLength(output, 'utf8') > DETAIL_STRING_BYTES) {
    output = clipUtf8(output, DETAIL_STRING_BYTES - Buffer.byteLength(suffix, 'utf8')) + suffix;
    budget.truncated = true;
  }
  const available = DETAIL_CONTENT_BYTES - budget.bytes;
  while (output && Buffer.byteLength(JSON.stringify(output), 'utf8') > available) {
    output = output.slice(0, -1);
    budget.truncated = true;
  }
  if (output !== value && !output.endsWith(suffix) && available >= 5) {
    output = clipUtf8(output, Math.max(0, Buffer.byteLength(output, 'utf8') - 3)) + suffix;
  }
  return chargedPrimitive(output, budget);
}

function clipUtf8(value: string, maximum: number): string {
  let clipped = Buffer.from(value).subarray(0, maximum).toString('utf8');
  while (Buffer.byteLength(clipped, 'utf8') > maximum) clipped = clipped.slice(0, -1);
  return clipped;
}

function chargeItem(budget: DetailBudget): boolean {
  if (++budget.items <= DETAIL_TOTAL_ITEMS) return true;
  budget.truncated = true;
  return false;
}

function charge(budget: DetailBudget, bytes: number): boolean {
  if (budget.bytes + bytes <= DETAIL_CONTENT_BYTES) {
    budget.bytes += bytes;
    return true;
  }
  budget.truncated = true;
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
