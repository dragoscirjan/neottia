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
  public constructor(
    public readonly category: DesignDocsErrorCategory,
    public readonly code: string,
    message: string,
    public readonly paths: readonly string[] = [],
    public readonly details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DesignDocsError';
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
    return new DesignDocsError(category, error.code, error.message, [], undefined, { cause: error });
  }
  return new DesignDocsError(
    'synchronization',
    'UNEXPECTED',
    error instanceof Error ? error.message : String(error),
    [],
    undefined,
    {
      cause: error,
    },
  );
}

/** Produces the transport-neutral structured error object used by tool hosts. */
export function serializeDesignDocsError(error: unknown): {
  category: string;
  code: string;
  message: string;
  paths: readonly string[];
  details?: Readonly<Record<string, unknown>>;
} {
  const value = asDesignDocsError(error);
  return {
    category: value.category,
    code: value.code,
    message: value.message,
    paths: value.paths,
    ...(value.details === undefined ? {} : { details: value.details }),
  };
}
