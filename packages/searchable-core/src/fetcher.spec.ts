import { describe, expect, it } from 'vitest';
import { loadSearchableConfig, type SearchableConfigInput } from './config.js';
import { fetchPage } from './fetcher.js';
import type { SearchableHttpRequest, SearchableHttpResponse, SearchableHttpTransport } from './http.js';

class SequenceTransport implements SearchableHttpTransport {
  public readonly requests: SearchableHttpRequest[] = [];
  public constructor(private readonly responses: SearchableHttpResponse[]) {}
  public async request(input: SearchableHttpRequest) {
    this.requests.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error('Unexpected request.');
    return response;
  }
}

function response(body: string, url: string, contentType = 'text/html', status = 200): SearchableHttpResponse {
  return { status, headers: { 'content-type': contentType }, bytes: Buffer.from(body), finalUrl: new URL(url) };
}

function context(fetch: SearchableConfigInput['fetch']) {
  return { cwd: process.cwd(), config: loadSearchableConfig(process.cwd(), { enabled: true, fetch }) };
}

describe('fetch strategies', () => {
  it('extracts Readability HTML as Markdown in a bounded worker', async () => {
    const transport = new SequenceTransport([
      response(
        '<html><head><title>Guide</title></head><body><article><h1>Guide</h1><p>Useful paragraph for extraction.</p></article></body></html>',
        'https://example.com/guide',
      ),
    ]);
    const result = await fetchPage(
      transport,
      new URL('https://example.com/guide'),
      context({ strategies: ['direct'] }),
    );
    expect(result).toMatchObject({ title: 'Guide', url: 'https://example.com/guide', source: 'direct' });
    expect(result.content).toContain('Useful paragraph');
  });

  it('uses Jina only after direct failure', async () => {
    const transport = new SequenceTransport([
      response('', 'https://example.com/guide', 'text/html', 500),
      response('Title: Jina Guide\n\nFallback content.', 'https://r.jina.ai/https://example.com/guide', 'text/plain'),
    ]);
    const result = await fetchPage(
      transport,
      new URL('https://example.com/guide'),
      context({ strategies: ['direct', 'jina'] }),
    );
    expect(result).toMatchObject({ title: 'Jina Guide', source: 'jina', url: 'https://example.com/guide' });
    expect(transport.requests.map((request) => request.url.hostname)).toEqual(['example.com', 'r.jina.ai']);
  });

  it.each(['https://example.com/private?token=secret', 'https://example.com/private#token=secret'])(
    'does not disclose sensitive target components to Jina or Wayback: %s',
    async (url) => {
      const transport = new SequenceTransport([response('', url, 'text/html', 500)]);
      await expect(
        fetchPage(transport, new URL(url), context({ strategies: ['direct', 'jina', 'wayback'] })),
      ).rejects.toMatchObject({
        code: 'FETCH_FAILED',
        details: {
          strategies: [
            'direct: FETCH_UPSTREAM_FAILED',
            'jina: FALLBACK_DISCLOSURE_BLOCKED',
            'wayback: FALLBACK_DISCLOSURE_BLOCKED',
          ],
        },
      });
      expect(transport.requests).toHaveLength(1);
    },
  );

  it('rejects attacker-controlled Wayback snapshot origins', async () => {
    const transport = new SequenceTransport([
      response(
        JSON.stringify({ archived_snapshots: { closest: { url: 'https://127.0.0.1/internal' } } }),
        'https://archive.org/wayback/available',
        'application/json',
      ),
    ]);
    await expect(
      fetchPage(transport, new URL('https://example.com/guide'), context({ strategies: ['wayback'] })),
    ).rejects.toMatchObject({
      code: 'FETCH_FAILED',
      details: { strategies: ['wayback: WAYBACK_RESPONSE_INVALID'] },
    });
    expect(transport.requests).toHaveLength(1);
  });
});
