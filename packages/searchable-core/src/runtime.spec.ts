import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchableConfigSchema } from './config.js';
import { assertPublicAddress, type SearchableHttpRequest, type SearchableHttpTransport } from './http.js';
import { createSearchableRuntime } from './runtime.js';
import type { StashedPageRecord } from './stash.js';
import { findSearchableTool } from './tools.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function project(extra = ''): string {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-searchable-runtime-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.neottia'));
  writeFileSync(join(cwd, '.neottia/config.yml'), `version: 1\nskills:\n  searchable:\n    enabled: true\n${extra}`);
  return cwd;
}

function tool(name: string) {
  const definition = findSearchableTool(name);
  if (!definition) throw new Error(`Missing tool ${name}.`);
  return definition;
}

class FixtureTransport implements SearchableHttpTransport {
  public readonly requests: SearchableHttpRequest[] = [];

  public async request(input: SearchableHttpRequest) {
    this.requests.push(input);
    if (input.url.hostname === 'html.duckduckgo.com')
      return response(
        '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">Example</a><div class="result__snippet">Result text</div></div>',
        'text/html',
        input.url,
      );
    if (input.url.pathname === '/api/generate')
      return response(
        `${JSON.stringify({ response: 'Grounded ', done: false })}\n${JSON.stringify({ response: 'answer.', done: true })}\n`,
        'application/x-ndjson',
        input.url,
      );
    return response(
      '<html><head><title>Example page</title></head><body><main><article><h1>Example page</h1><p>Canonical searchable content for tests.</p></article></main></body></html>',
      'text/html',
      input.url,
    );
  }

  public async stream(input: SearchableHttpRequest) {
    const buffered = await this.request(input);
    return streamResponse([buffered.bytes], input.url);
  }
}

describe('concrete Searchable runtime', () => {
  it('uses an injected immutable config without reading a project file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'neottia-searchable-injected-'));
    roots.push(cwd);
    const config = Object.freeze(searchableConfigSchema.parse({ enabled: true, root: 'searchable-data' }));
    const runtime = createSearchableRuntime({ cwd, config, transport: new FixtureTransport() });

    expect(runtime.store.config).toBe(config);
    expect(() => createSearchableRuntime({ cwd, config, configOverrides: { enabled: false } })).toThrow(TypeError);
    await runtime.close();
  });

  it('runs provider search, bounded extraction, canonical stash, grep, and Ollama ask', async () => {
    const cwd = project();
    const transport = new FixtureTransport();
    const runtime = createSearchableRuntime({ cwd, transport });
    const context = { cwd, services: runtime };

    const searched = await tool('web_search').run(context, { query: 'neottia' });
    expect(searched).toMatchObject({ results: [{ title: 'Example', url: 'https://example.com/page' }] });
    const fetched = (await tool('web_fetch').run(context, { url: 'https://example.com/page' })) as {
      title: string;
      content: string;
      url: string;
    };
    expect(fetched.content).toContain('Canonical searchable content');
    await tool('web_stash').run(context, fetched);
    const grep = await tool('web_grep').run(context, { query: 'canonical content' });
    expect(grep).toMatchObject({ results: [{ url: 'https://example.com/page', title: 'Example page' }] });
    const answer = await tool('web_ask').run(context, { question: 'searchable' });
    expect(answer).toEqual({ answer: 'Grounded answer.', contextUrls: ['https://example.com/page'] });
    const askRequest = transport.requests.find((request) => request.url.pathname === '/api/generate');
    expect(JSON.parse(Buffer.from(askRequest?.body ?? []).toString('utf8'))).toMatchObject({ stream: true });

    const pages = join(cwd, '.neottia/searchable/pages');
    const file = readFileSync(join(pages, readdirSync(pages)[0] as string), 'utf8');
    expect(file).toContain('Canonical searchable content');
    await runtime.close();
    await expect(tool('web_search').run(context, { query: 'closed' })).rejects.toMatchObject({
      code: 'RUNTIME_CLOSED',
    });
  });

  it('uses one ask deadline for context lookup and streamed generation', async () => {
    const cwd = project('    ollama:\n      timeout_ms: 1000\n');
    const transport = new FixtureTransport();
    const runtime = createSearchableRuntime({ cwd, transport });
    const page = {
      version: 1 as const,
      id: `page-${'a'.repeat(64)}`,
      url: 'https://example.com/context',
      title: 'Context',
      content: 'shared deadline marker',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    let contextDeadline: object | undefined;
    vi.spyOn(runtime.store, 'context').mockImplementation(async (_input, context) => {
      contextDeadline = context?.transportDeadline;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [page];
    });
    const context = { cwd, services: runtime };
    await tool('web_ask').run(context, { question: 'marker' });
    const request = transport.requests.find((value) => value.url.pathname === '/api/generate');
    expect(contextDeadline).toBeDefined();
    expect(request?.deadline).toBe(contextDeadline);
    await runtime.close();
  });

  it('returns only the source URLs included in the bounded Ollama prompt', async () => {
    const cwd = project('    ask:\n      context_bytes: 400\n');
    const transport = new FixtureTransport();
    const runtime = createSearchableRuntime({ cwd, transport });
    const timestamp = new Date().toISOString();
    const pages: StashedPageRecord[] = [
      {
        version: 1,
        id: `page-${'a'.repeat(64)}`,
        url: 'https://example.com/included',
        title: 'Included',
        content: 'included '.repeat(100),
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        version: 1,
        id: `page-${'b'.repeat(64)}`,
        url: 'https://example.com/excluded',
        title: 'Excluded',
        content: 'excluded context',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ];
    vi.spyOn(runtime.store, 'context').mockResolvedValue(pages);

    const answer = await tool('web_ask').run({ cwd, services: runtime }, { question: 'marker' });
    expect(answer).toEqual({ answer: 'Grounded answer.', contextUrls: ['https://example.com/included'] });
    const request = transport.requests.find((value) => value.url.pathname === '/api/generate');
    const prompt = JSON.parse(Buffer.from(request?.body ?? []).toString('utf8')) as { prompt: string };
    expect(prompt.prompt).toContain('https://example.com/included');
    expect(prompt.prompt).not.toContain('https://example.com/excluded');
    await runtime.close();
  });

  it('returns a stable error without calling Ollama when no context matches', async () => {
    const cwd = project();
    const transport = new FixtureTransport();
    const runtime = createSearchableRuntime({ cwd, transport });
    await expect(tool('web_ask').run({ cwd, services: runtime }, { question: 'missing' })).rejects.toMatchObject({
      code: 'NO_RELEVANT_CONTEXT',
    });
    expect(transport.requests.some((request) => request.url.pathname === '/api/generate')).toBe(false);
    await runtime.close();
  });

  it('rejects a malformed Ollama frame immediately and cancels its transport', async () => {
    const cwd = project();
    let cancelled = false;
    let reads = 0;
    const transport: SearchableHttpTransport = {
      async request(input) {
        return response('', 'application/x-ndjson', input.url);
      },
      async stream(input) {
        async function* chunks() {
          reads += 1;
          yield Buffer.from('{"response":"unfinished","done":false}\nnot-json\n');
          reads += 1;
          await new Promise(() => undefined);
        }
        return {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
          chunks: chunks(),
          finalUrl: input.url,
          cancel: () => {
            cancelled = true;
          },
        };
      },
    };
    const runtime = createSearchableRuntime({ cwd, transport });
    await runtime.store.stash({
      url: 'https://example.com/malformed',
      title: 'Malformed',
      content: 'malformed stream marker',
    });
    await expect(
      tool('web_ask').run({ cwd, services: runtime }, { question: 'malformed stream marker' }),
    ).rejects.toMatchObject({ code: 'OLLAMA_RESPONSE_INVALID' });
    expect(cancelled).toBe(true);
    expect(reads).toBe(1);
    await runtime.close();
  });

  it.each([
    {
      chunks: ['x'.repeat(513)],
      frames: false,
    },
    {
      chunks: [
        `${JSON.stringify({ response: 'a'.repeat(300), done: false })}\n`,
        `${JSON.stringify({ response: 'b'.repeat(300), done: true })}\n`,
      ],
      frames: true,
    },
  ])('bounds partial frames and cumulative streamed answers (frames=$frames)', async ({ chunks, frames }) => {
    const cwd = project('    security:\n      limits:\n        max_result_bytes: 512\n');
    let cancelled = false;
    const transport: SearchableHttpTransport = {
      async request(input) {
        return response('', 'application/x-ndjson', input.url);
      },
      async stream(input) {
        return streamResponse(
          chunks.map((chunk) => Buffer.from(chunk)),
          input.url,
          () => {
            cancelled = true;
          },
        );
      },
    };
    const runtime = createSearchableRuntime({ cwd, transport });
    await runtime.store.stash({
      url: `https://example.com/${frames ? 'answer' : 'partial'}`,
      title: 'Bounded',
      content: 'bounded stream marker',
    });
    await expect(
      tool('web_ask').run({ cwd, services: runtime }, { question: 'bounded stream marker' }),
    ).rejects.toMatchObject({ code: 'OLLAMA_RESPONSE_TOO_LARGE' });
    expect(cancelled).toBe(true);
    await runtime.close();
  });

  it('blocks private and special-use addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '::1',
      'fc00::1',
      '::ffff:127.0.0.1',
    ])
      expect(() => assertPublicAddress(address)).toThrowError(
        expect.objectContaining({ code: 'NETWORK_DESTINATION_BLOCKED' }),
      );
    expect(() => assertPublicAddress('8.8.8.8')).not.toThrow();
  });
});

function response(body: string, contentType: string, finalUrl: URL) {
  return Promise.resolve({
    status: 200,
    headers: { 'content-type': contentType },
    bytes: Buffer.from(body),
    finalUrl: new URL(finalUrl),
  });
}

function streamResponse(chunks: readonly Uint8Array[], finalUrl: URL, cancel = () => {}) {
  return {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
    chunks: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    finalUrl: new URL(finalUrl),
    cancel,
  };
}
