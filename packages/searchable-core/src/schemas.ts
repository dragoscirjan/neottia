import { z } from 'zod';

/** Hard schema caps bound parsing; configured UTF-8 caps may be tighter at execution. */
export const searchableProviderSchema = z.enum(['duckduckgo', 'google', 'bing', 'brave']);
/** Fetch provenance preserved from the upstream Searchable result. */
export const webFetchSourceSchema = z.enum(['direct', 'jina', 'wayback']);

const HTTP_URL_PATTERN = /^[hH][tT][tT][pP][sS]?:\/\//u;
/** HTTP(S)-only URL schema whose protocol constraint survives JSON Schema generation. */
export const searchableHttpUrlSchema = z
  .url()
  .regex(HTTP_URL_PATTERN, 'must use HTTP(S)')
  .max(8 * 1024)
  .meta({ format: 'uri' });
const title = z
  .string()
  .min(1)
  .max(4 * 1024);
const content = z.string().max(10 * 1024 * 1024);

/** Normalized web-search result returned by every injected provider. */
export const webSearchResultSchema = z
  .object({
    title,
    url: searchableHttpUrlSchema,
    snippet: z.string().max(10 * 1024 * 1024),
    siteName: z
      .string()
      .min(1)
      .max(4 * 1024)
      .optional(),
  })
  .strict();

/** Extracted page contract shared by fetch and stash services. */
export const webFetchResultSchema = z
  .object({
    title,
    content,
    url: searchableHttpUrlSchema,
    excerpt: z
      .string()
      .max(10 * 1024 * 1024)
      .optional(),
    siteName: z
      .string()
      .min(1)
      .max(4 * 1024)
      .optional(),
    source: webFetchSourceSchema,
  })
  .strict();

/** Ranked stashed-page match compatible with the upstream storage result. */
export const webGrepResultSchema = z
  .object({
    url: searchableHttpUrlSchema,
    title,
    snippet: z.string().max(10 * 1024 * 1024),
    rank: z.number().finite(),
  })
  .strict();

/** Context-backed model answer compatible with the upstream ask result. */
export const webAskResultSchema = z
  .object({
    answer: content,
    contextUrls: z.array(searchableHttpUrlSchema).max(100),
  })
  .strict();

export type SearchableProvider = z.infer<typeof searchableProviderSchema>;
export type WebFetchSource = z.infer<typeof webFetchSourceSchema>;
export type WebSearchResult = z.infer<typeof webSearchResultSchema>;
export type WebFetchResult = z.infer<typeof webFetchResultSchema>;
export type WebGrepResult = z.infer<typeof webGrepResultSchema>;
export type WebAskResult = z.infer<typeof webAskResultSchema>;
