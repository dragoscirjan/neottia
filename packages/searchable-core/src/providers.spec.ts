import { describe, expect, it } from 'vitest';
import { loadSearchableConfig, type SearchableConfigInput } from './config.js';
import type { SearchableHttpRequest, SearchableHttpTransport } from './http.js';
import { searchProvider } from './providers.js';

class ProviderTransport implements SearchableHttpTransport {
  public readonly requests: SearchableHttpRequest[] = [];
  public constructor(
    private readonly body: unknown,
    private readonly status = 200,
  ) {}

  public async request(input: SearchableHttpRequest) {
    this.requests.push(input);
    return {
      status: this.status,
      headers: {},
      bytes: Buffer.from(typeof this.body === 'string' ? this.body : JSON.stringify(this.body)),
      finalUrl: input.url,
    };
  }
}

function context(search: SearchableConfigInput['search']) {
  return {
    cwd: process.cwd(),
    config: loadSearchableConfig(process.cwd(), { enabled: true, search }),
  };
}

describe('search providers', () => {
  it('decodes DuckDuckGo redirect links without credentials', async () => {
    const transport = new ProviderTransport(
      '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fresult">Result</a><div class="result__snippet">Snippet</div></div>',
    );
    const result = await searchProvider(
      transport,
      { query: 'test', provider: 'duckduckgo', limit: 5 },
      context({ provider: 'duckduckgo' }),
    );
    expect(result).toEqual({ results: [{ title: 'Result', url: 'https://example.com/result', snippet: 'Snippet' }] });
    expect(transport.requests[0]).toMatchObject({ method: 'POST', redirectPolicy: 'none' });
  });

  it.each([
    {
      provider: 'google' as const,
      credentials: { google_api_key: 'google-key', google_cse_id: 'google-cx' },
      body: { items: [{ title: 'Google', link: 'https://example.com/google', snippet: 'G' }] },
      host: 'www.googleapis.com',
      title: 'Google',
      parameter: 'num',
      cap: '10',
    },
    {
      provider: 'bing' as const,
      credentials: { bing_api_key: 'bing-key' },
      body: { webPages: { value: [{ name: 'Bing', url: 'https://example.com/bing', snippet: 'B' }] } },
      host: 'api.bing.microsoft.com',
      title: 'Bing',
      parameter: 'count',
      cap: '50',
    },
    {
      provider: 'brave' as const,
      credentials: { brave_api_key: 'brave-key' },
      body: { web: { results: [{ title: 'Brave', url: 'https://example.com/brave', description: 'B' }] } },
      host: 'api.search.brave.com',
      title: 'Brave',
      parameter: 'count',
      cap: '20',
    },
  ])('maps $provider requests and responses', async ({ provider, credentials, body, host, title, parameter, cap }) => {
    const transport = new ProviderTransport(body);
    const result = await searchProvider(
      transport,
      { query: 'test', provider, limit: 100 },
      context({ provider, credentials }),
    );
    expect(result.results[0]).toMatchObject({ title });
    expect(transport.requests[0]?.url.hostname).toBe(host);
    expect(transport.requests[0]?.redirectPolicy).toBe('none');
    expect(transport.requests[0]?.url.searchParams.get(parameter)).toBe(cap);
  });

  it.each(['google', 'bing', 'brave'] as const)(
    'fails before transport when %s credentials are absent',
    async (provider) => {
      const transport = new ProviderTransport({});
      await expect(
        searchProvider(transport, { query: 'test', provider, limit: 5 }, context({ provider })),
      ).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_MISSING' });
      expect(transport.requests).toHaveLength(0);
    },
  );

  it.each([
    [400, 'PROVIDER_UNAVAILABLE'],
    [401, 'PROVIDER_AUTH_FAILED'],
    [403, 'PROVIDER_AUTH_FAILED'],
    [429, 'PROVIDER_RATE_LIMITED'],
    [500, 'PROVIDER_UNAVAILABLE'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const transport = new ProviderTransport({}, status);
    await expect(
      searchProvider(
        transport,
        { query: 'test', provider: 'brave', limit: 5 },
        context({ provider: 'brave', credentials: { brave_api_key: 'key' } }),
      ),
    ).rejects.toMatchObject({ code });
  });

  it('rejects malformed provider payloads', async () => {
    const malformed = new ProviderTransport('null');
    await expect(
      searchProvider(
        malformed,
        { query: 'test', provider: 'brave', limit: 5 },
        context({ provider: 'brave', credentials: { brave_api_key: 'secret-key' } }),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
  });

  it.each([
    ['plain secret', 'secret-key', 'secret-key'],
    ['quote', 'secret"key', 'secret"key'],
    ['backslash', 'secret\\key', 'secret\\key'],
    ['control character', 'secret\nkey', 'secret\nkey'],
    ['percent encoding', 'secret/key', 'secret%2Fkey'],
  ])('rejects %s credentials in actual output strings', async (_case, credential, output) => {
    const leaked = new ProviderTransport({
      web: { results: [{ title: output, url: 'https://example.com/result', description: 'result' }] },
    });
    await expect(
      searchProvider(
        leaked,
        { query: 'test', provider: 'brave', limit: 5 },
        context({ provider: 'brave', credentials: { brave_api_key: credential } }),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
  });
});
