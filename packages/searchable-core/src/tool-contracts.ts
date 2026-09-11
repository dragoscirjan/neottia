import { z } from 'zod';
import {
  searchableHttpUrlSchema,
  searchableProviderSchema,
  webAskResultSchema,
  webFetchResultSchema,
  webFetchSourceSchema,
  webGrepResultSchema,
  webSearchResultSchema,
} from './schemas.js';

const query = z
  .string()
  .trim()
  .min(1)
  .regex(/\S/u, 'must not be blank')
  .max(16 * 1024);
const limit = z.number().int().min(1).max(100);

/** Marks an optional tool limit with its public default without resolving it early. */
function configuredLimit(defaultValue: number) {
  return limit.optional().meta({ default: defaultValue });
}

/** The sole authoritative runtime contract map for all five Searchable tools. */
export const searchableToolSchemas = {
  web_search: {
    input: z
      .object({
        query,
        provider: searchableProviderSchema.optional().meta({ default: 'duckduckgo' }),
        limit: configuredLimit(5),
      })
      .strict(),
    output: z.object({ results: z.array(webSearchResultSchema).max(100) }).strict(),
  },
  web_fetch: {
    input: z.object({ url: searchableHttpUrlSchema }).strict(),
    output: webFetchResultSchema,
  },
  web_stash: {
    input: z
      .object({
        url: searchableHttpUrlSchema,
        title: z
          .string()
          .trim()
          .min(1)
          .regex(/\S/u, 'must not be blank')
          .max(4 * 1024),
        // Validate nonblank content without transforming caller-owned page text.
        content: z
          .string()
          .min(1)
          .regex(/\S/u, 'must not be blank')
          .max(10 * 1024 * 1024),
        excerpt: z
          .string()
          .max(10 * 1024 * 1024)
          .optional(),
        siteName: z
          .string()
          .trim()
          .min(1)
          .regex(/\S/u, 'must not be blank')
          .max(4 * 1024)
          .optional(),
        source: webFetchSourceSchema.optional(),
      })
      .strict(),
    output: z.object({ stashed: z.literal(true), url: searchableHttpUrlSchema }).strict(),
  },
  web_grep: {
    // Upstream docs define only query and limit; strict mode rejects its accidental provider field.
    input: z.object({ query, limit: configuredLimit(5) }).strict(),
    output: z.object({ results: z.array(webGrepResultSchema).max(100) }).strict(),
  },
  web_ask: {
    input: z.object({ question: query, limit: configuredLimit(3) }).strict(),
    output: webAskResultSchema,
  },
} as const;

export type SearchableToolName = keyof typeof searchableToolSchemas;
export type SearchableToolInput<Name extends SearchableToolName> = z.output<
  (typeof searchableToolSchemas)[Name]['input']
>;
export type SearchableToolOutput<Name extends SearchableToolName> = z.output<
  (typeof searchableToolSchemas)[Name]['output']
>;

type ConfiguredInputDefaults = {
  web_search: { provider: z.output<typeof searchableProviderSchema>; limit: number };
  web_fetch: Record<never, never>;
  web_stash: Record<never, never>;
  web_grep: { limit: number };
  web_ask: { limit: number };
};

/** Service-facing input after omitted public fields are resolved from configuration. */
export type ResolvedSearchableToolInput<Name extends SearchableToolName> = SearchableToolInput<Name> &
  ConfiguredInputDefaults[Name];

/** Generates host JSON Schema directly from the canonical Zod contracts. */
export function searchableToolJsonSchema(
  name: SearchableToolName,
  boundary: 'input' | 'output',
): Record<string, unknown> {
  return z.toJSONSchema(searchableToolSchemas[name][boundary]) as Record<string, unknown>;
}
