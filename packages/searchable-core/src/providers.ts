import { JSDOM } from 'jsdom';
import { SearchableError } from './errors.js';
import { createSearchableDeadline, type SearchableHttpTransport } from './http.js';
import { containsCredential } from './redaction.js';
import type { SearchableOperationContext } from './services.js';
import type { ResolvedSearchableToolInput, SearchableToolOutput } from './tool-contracts.js';

/** Provider implementation selected after configuration precedence resolves. */
export interface SearchProvider {
  search(
    input: ResolvedSearchableToolInput<'web_search'>,
    context: SearchableOperationContext,
  ): Promise<SearchableToolOutput<'web_search'>>;
}

/** Creates the configured provider without reading process environment again. */
export function createSearchProvider(
  transport: SearchableHttpTransport,
  input: ResolvedSearchableToolInput<'web_search'>,
): SearchProvider {
  return {
    search: async (_resolved, context) => searchProvider(transport, input, context),
  };
}

/** Executes one provider request and normalizes its public result shape. */
export async function searchProvider(
  transport: SearchableHttpTransport,
  input: ResolvedSearchableToolInput<'web_search'>,
  context: SearchableOperationContext,
): Promise<SearchableToolOutput<'web_search'>> {
  const deadline =
    context.transportDeadline ?? createSearchableDeadline(context.config.search.timeout_ms, context.deadline);
  const maximumBytes = Math.min(
    context.config.fetch.max_response_bytes,
    context.config.security.limits.max_result_bytes,
  );
  let results;
  if (input.provider === 'duckduckgo') {
    const body = new URLSearchParams({ q: input.query }).toString();
    const response = await transport.request({
      url: new URL('https://html.duckduckgo.com/html/'),
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Neottia Searchable/1' },
      body: Buffer.from(body),
      signal: context.signal,
      deadline,
      maximumBytes,
      redirectPolicy: 'none',
    });
    assertProviderStatus(response.status, input.provider);
    results = parseDuckDuckGo(Buffer.from(response.bytes).toString('utf8'));
  } else if (input.provider === 'google') {
    const key = requireCredential(context.config.search.credentials.google_api_key, 'google_api_key', 'google');
    const cx = requireCredential(context.config.search.credentials.google_cse_id, 'google_cse_id', 'google');
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.search = new URLSearchParams({ key, cx, q: input.query, num: String(Math.min(input.limit, 10)) }).toString();
    const response = await transport.request({
      url,
      signal: context.signal,
      deadline,
      maximumBytes,
      redirectPolicy: 'none',
    });
    assertProviderStatus(response.status, input.provider);
    results = parseJsonResults(response.bytes, input.provider, 'items');
  } else if (input.provider === 'bing') {
    const key = requireCredential(context.config.search.credentials.bing_api_key, 'bing_api_key', 'bing');
    const url = new URL(context.config.search.bing_api_endpoint);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new SearchableError(
        'configuration',
        'PROVIDER_ENDPOINT_INVALID',
        'The Bing endpoint must be an HTTPS URL without user information.',
      );
    url.searchParams.set('q', input.query);
    url.searchParams.set('count', String(Math.min(input.limit, 50)));
    const response = await transport.request({
      url,
      headers: { 'Ocp-Apim-Subscription-Key': key },
      signal: context.signal,
      deadline,
      maximumBytes,
      redirectPolicy: 'none',
    });
    assertProviderStatus(response.status, input.provider);
    results = parseBing(response.bytes);
  } else {
    const key = requireCredential(context.config.search.credentials.brave_api_key, 'brave_api_key', 'brave');
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.search = new URLSearchParams({ q: input.query, count: String(Math.min(input.limit, 20)) }).toString();
    const response = await transport.request({
      url,
      headers: { accept: 'application/json', 'x-subscription-token': key },
      signal: context.signal,
      deadline,
      maximumBytes,
      redirectPolicy: 'none',
    });
    assertProviderStatus(response.status, input.provider);
    results = parseBrave(response.bytes);
  }
  const bounded = results.slice(0, input.limit);
  rejectCredentialLeak(bounded, Object.values(context.config.search.credentials));
  return { results: bounded };
}

function parseDuckDuckGo(html: string): Array<{ title: string; url: string; snippet: string }> {
  const dom = new JSDOM(html);
  try {
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    for (const node of dom.window.document.querySelectorAll('.result')) {
      const link = node.querySelector<HTMLAnchorElement>('.result__a');
      if (!link?.textContent || !link.href) continue;
      const redirect = new URL(link.href, 'https://html.duckduckgo.com');
      const target = redirect.searchParams.get('uddg') ?? link.href;
      const url = normalizeResultUrl(target);
      if (!url) continue;
      results.push({
        title: link.textContent.trim(),
        url,
        snippet: node.querySelector('.result__snippet')?.textContent?.trim() ?? '',
      });
    }
    return results;
  } finally {
    dom.window.close();
  }
}

function parseJsonResults(
  bytes: Uint8Array,
  provider: string,
  field: string,
): Array<{ title: string; url: string; snippet: string }> {
  const root = parseJsonRecord(bytes, provider);
  const values = Array.isArray(root[field]) ? root[field] : [];
  return values.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = normalizeResultUrl(entry['link']);
    return typeof entry['title'] === 'string' && url
      ? [{ title: entry['title'], url, snippet: typeof entry['snippet'] === 'string' ? entry['snippet'] : '' }]
      : [];
  });
}

function parseBing(bytes: Uint8Array): Array<{ title: string; url: string; snippet: string }> {
  const root = parseJsonRecord(bytes, 'bing');
  const webPages = isRecord(root['webPages']) ? root['webPages'] : {};
  const values = Array.isArray(webPages['value']) ? webPages['value'] : [];
  return values.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = normalizeResultUrl(entry['url']);
    return typeof entry['name'] === 'string' && url
      ? [{ title: entry['name'], url, snippet: typeof entry['snippet'] === 'string' ? entry['snippet'] : '' }]
      : [];
  });
}

function parseBrave(bytes: Uint8Array): Array<{ title: string; url: string; snippet: string }> {
  const root = parseJsonRecord(bytes, 'brave');
  const web = isRecord(root['web']) ? root['web'] : {};
  const values = Array.isArray(web['results']) ? web['results'] : [];
  return values.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = normalizeResultUrl(entry['url']);
    return typeof entry['title'] === 'string' && url
      ? [
          {
            title: entry['title'],
            url,
            snippet:
              typeof entry['description'] === 'string'
                ? entry['description']
                : typeof entry['snippet'] === 'string'
                  ? entry['snippet']
                  : '',
          },
        ]
      : [];
  });
}

function parseJsonRecord(bytes: Uint8Array, provider: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    if (isRecord(value)) return value;
  } catch {
    // Return the same bounded failure for syntax and root-shape errors.
  }
  throw new SearchableError('service', 'PROVIDER_RESPONSE_INVALID', `The ${provider} response is not valid JSON.`);
}

function assertProviderStatus(status: number, provider: string): void {
  if (status >= 200 && status < 300) return;
  const code =
    status === 401 || status === 403
      ? 'PROVIDER_AUTH_FAILED'
      : status === 429
        ? 'PROVIDER_RATE_LIMITED'
        : 'PROVIDER_UNAVAILABLE';
  throw new SearchableError('service', code, `The ${provider} provider returned HTTP ${status}.`, [], {
    provider,
    status,
  });
}

function requireCredential(value: string | undefined, name: string, provider: string): string {
  if (!value)
    throw new SearchableError(
      'configuration',
      'PROVIDER_CREDENTIAL_MISSING',
      `The ${provider} provider requires ${name}.`,
      [`search.credentials.${name}`],
    );
  return value;
}

function normalizeResultUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function rejectCredentialLeak(value: unknown, credentials: readonly (string | undefined)[]): void {
  const secrets = credentials.filter((credential): credential is string => Boolean(credential));
  if (containsCredentialInValue(value, secrets))
    throw new SearchableError(
      'service',
      'PROVIDER_RESPONSE_INVALID',
      'The provider response contained a configured credential.',
    );
}

/** Inspects actual strings so JSON escaping cannot disguise a credential. */
function containsCredentialInValue(value: unknown, credentials: readonly string[]): boolean {
  if (typeof value === 'string') return containsCredential(value, credentials);
  if (Array.isArray(value)) return value.some((entry) => containsCredentialInValue(entry, credentials));
  if (!isRecord(value)) return false;
  return Object.values(value).some((entry) => containsCredentialInValue(entry, credentials));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
