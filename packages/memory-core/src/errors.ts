import type { ZodError } from 'zod';

/**
 * Error taxonomy for the memory module. Config errors carry the validated
 * shard paths so harnesses can surface precise messages to users.
 */

export class ConfigError extends Error {
  public constructor(
    message: string,
    public readonly validationPaths: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class MemoryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MemoryError';
  }
}

export class MemoryConflictError extends MemoryError {
  public constructor(message: string) {
    super(message);
    this.name = 'MemoryConflictError';
  }
}

export class MemoryLockError extends MemoryError {
  public constructor(message: string) {
    super(message);
    this.name = 'MemoryLockError';
  }
}

/** Formats a Zod error as an indented, user-readable issue list. */
export function formatSchemaError(error: ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
    .join('\n');
}
