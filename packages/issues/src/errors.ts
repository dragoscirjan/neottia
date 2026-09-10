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
    this.details = options.details;
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
