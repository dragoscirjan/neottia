/** Resource ceilings applied before filesystem or SQLite mutation. */
export interface StoreLimits {
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
  readonly maxBatchPaths: number;
  readonly maxBeforeImageBytes: number;
  readonly maxJournalBytes: number;
  readonly maxTemporaryBytes: number;
  readonly maxSqlBytes: number;
  readonly maxStatementParameterBytes: number;
  readonly maxQueryRows: number;
  readonly maxQueryResultBytes: number;
}

/** Conservative defaults suitable for local repository metadata. */
export const DEFAULT_STORE_LIMITS: StoreLimits = {
  maxFileBytes: 1_048_576,
  maxFiles: 10_000,
  maxTotalBytes: 64 * 1_048_576,
  maxBatchPaths: 1_000,
  maxBeforeImageBytes: 32 * 1_048_576,
  maxJournalBytes: 4 * 1_048_576,
  maxTemporaryBytes: 64 * 1_048_576,
  maxSqlBytes: 1_048_576,
  maxStatementParameterBytes: 1_048_576,
  maxQueryRows: 10_000,
  maxQueryResultBytes: 16 * 1_048_576,
};
