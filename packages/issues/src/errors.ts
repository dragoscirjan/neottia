import { RepositoryStoreError } from '@neottia/repository-store';

/** Stable issue-domain error categories exposed by every tool adapter. */
export type IssueErrorCategory = 'configuration' | 'validation' | 'not_found' | 'conflict' | 'cross_domain' | 'storage';

/** Structured operational error that remains useful across JSON boundaries. */
export class IssueError extends Error {
  readonly category: IssueErrorCategory;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    category: IssueErrorCategory = 'validation',
    code = 'ISSUE_INVALID',
    options: {
      retryable?: boolean;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'IssueError';
    this.category = category;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details === undefined ? undefined : boundedDetails(options.details);
  }

  /** Produces a JSON-safe error body for MCP and in-process harnesses. */
  toJSON(): Record<string, unknown> {
    return {
      category: this.category,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/** Preserves repository-store classification instead of flattening failures. */
export function asIssueError(error: unknown): IssueError {
  if (error instanceof IssueError) return error;
  if (error instanceof RepositoryStoreError)
    return new IssueError(
      error.message,
      error.category === 'stale_revision' || error.category === 'contention' ? 'conflict' : 'storage',
      error.code,
      {
        retryable: error.retryable,
        details: error.evidence,
        cause: error,
      },
    );
  return new IssueError(error instanceof Error ? error.message : String(error), 'storage', 'ISSUE_OPERATION_FAILED', {
    cause: error,
  });
}

const DETAIL_STRING_BYTES = 1024;
const DETAIL_TOTAL_BYTES = 16 * 1024;
const DETAIL_ITEMS = 20;
const DETAIL_DEPTH = 5;

/** Copies provider-controlled diagnostics into a bounded JSON-safe value. */
function boundedDetails(details: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const budget = { bytes: 0, truncated: false };
  const sanitized = sanitizeValue(details, budget, 0);
  const result = isRecord(sanitized) ? sanitized : { value: sanitized };
  return budget.truncated ? { ...result, detailsTruncated: true } : result;
}

function sanitizeValue(value: unknown, budget: { bytes: number; truncated: boolean }, depth: number): unknown {
  if (budget.bytes >= DETAIL_TOTAL_BYTES || depth >= DETAIL_DEPTH) {
    budget.truncated = true;
    return '[truncated]';
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') {
    const bytes = Buffer.byteLength(value);
    const allowance = Math.min(DETAIL_STRING_BYTES, DETAIL_TOTAL_BYTES - budget.bytes);
    if (bytes <= allowance) {
      budget.bytes += bytes;
      return value;
    }
    budget.truncated = true;
    const clipped = Buffer.from(value)
      .subarray(0, Math.max(0, allowance - 3))
      .toString('utf8');
    budget.bytes += Buffer.byteLength(clipped) + 3;
    return `${clipped}...`;
  }
  if (Array.isArray(value)) {
    if (value.length > DETAIL_ITEMS) budget.truncated = true;
    const result: unknown[] = [];
    for (const item of value.slice(0, DETAIL_ITEMS)) {
      if (budget.bytes >= DETAIL_TOTAL_BYTES) {
        budget.truncated = true;
        break;
      }
      result.push(sanitizeValue(item, budget, depth + 1));
    }
    return result;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    if (entries.length > DETAIL_ITEMS) budget.truncated = true;
    const result: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, DETAIL_ITEMS)) {
      const keyBytes = Buffer.byteLength(key);
      if (budget.bytes + keyBytes >= DETAIL_TOTAL_BYTES) {
        budget.truncated = true;
        break;
      }
      budget.bytes += keyBytes;
      result[key] = sanitizeValue(item, budget, depth + 1);
    }
    return result;
  }
  budget.bytes += Buffer.byteLength(String(value));
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
