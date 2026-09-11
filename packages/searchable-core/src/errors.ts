import { z } from 'zod';

/** Stable failure categories shared by every future Searchable adapter. */
export const searchableErrorCategorySchema = z.enum([
  'configuration',
  'validation',
  'resource_limit',
  'cancelled',
  'service',
]);

/** Runtime-validated structured error payload for transport adapters. */
export const searchableErrorSchema = z
  .object({
    category: searchableErrorCategorySchema,
    code: z.string().min(1),
    message: z.string().min(1),
    paths: z.array(z.string()),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type SearchableErrorCategory = z.infer<typeof searchableErrorCategorySchema>;
export type SearchableErrorData = z.infer<typeof searchableErrorSchema>;

/** Typed, machine-readable failure that never requires exposing its cause. */
export class SearchableError extends Error {
  public constructor(
    public readonly category: SearchableErrorCategory,
    public readonly code: string,
    message: string,
    public readonly paths: readonly string[] = [],
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'SearchableError';
  }
}

/** Converts a Searchable failure into a transport-neutral object. */
export function serializeSearchableError(error: SearchableError): SearchableErrorData {
  return searchableErrorSchema.parse({
    category: error.category,
    code: error.code,
    message: error.message,
    paths: [...error.paths],
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}
