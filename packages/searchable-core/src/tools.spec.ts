import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchableError, serializeSearchableError } from './errors.js';
import type { SearchableServices } from './services.js';
import { findSearchableTool, SEARCHABLE_TOOLS } from './tools.js';

let cwd = '';

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'neottia-searchable-tools-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/** Produces complete caller-owned fakes so tests exercise only the shared registry. */
function services(): SearchableServices {
  return {
    search: vi.fn(async () => ({ results: [] })),
    fetch: vi.fn(async ({ url }) => ({ title: 'Page', content: 'Body', url, source: 'direct' })),
    stash: vi.fn(async ({ url }) => ({ stashed: true as const, url })),
    grep: vi.fn(async () => ({ results: [] })),
    ask: vi.fn(async () => ({ answer: 'Answer', contextUrls: [] })),
  };
}

/** Fetches a known definition while preserving a useful test failure if absent. */
function tool(name: string) {
  const definition = findSearchableTool(name);
  if (!definition) throw new Error(`Missing test tool ${name}.`);
  return definition;
}

describe('SEARCHABLE_TOOLS', () => {
  it('injects every operation and passes normalized defaults plus controls', async () => {
    const injected = services();
    const controller = new AbortController();
    const context = { cwd: cwd, services: injected, signal: controller.signal };

    await tool('web_search').run(context, { query: '  subject  ' });
    await tool('web_fetch').run(context, { url: 'https://example.com/page' });
    await tool('web_stash').run(context, {
      url: 'https://example.com/page',
      title: 'Page',
      content: 'Body',
    });
    await tool('web_grep').run(context, { query: 'subject' });
    await tool('web_ask').run(context, { question: 'What?' });

    expect(injected.search).toHaveBeenCalledWith(
      { query: 'subject', provider: 'duckduckgo', limit: 5 },
      expect.objectContaining({ cwd: context.cwd, signal: controller.signal }),
    );
    expect(injected.grep).toHaveBeenCalledWith(
      { query: 'subject', limit: 5 },
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(injected.ask).toHaveBeenCalledWith(
      { question: 'What?', limit: 3 },
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(SEARCHABLE_TOOLS).toHaveLength(5);
  });

  it('resolves omitted defaults from config while explicit tool inputs win', async () => {
    const injected = services();
    const context = {
      cwd,
      services: injected,
      configOverrides: {
        search: { provider: 'brave' as const, limit: 9 },
        grep: { limit: 8 },
        ask: { limit: 7 },
      },
    };

    await tool('web_search').run(context, { query: 'configured' });
    await tool('web_grep').run(context, { query: 'configured' });
    await tool('web_ask').run(context, { question: 'configured' });
    await tool('web_search').run(context, { query: 'explicit', provider: 'google', limit: 2 });
    await tool('web_grep').run(context, { query: 'explicit', limit: 3 });
    await tool('web_ask').run(context, { question: 'explicit', limit: 4 });

    expect(injected.search).toHaveBeenNthCalledWith(
      1,
      { query: 'configured', provider: 'brave', limit: 9 },
      expect.any(Object),
    );
    expect(injected.search).toHaveBeenNthCalledWith(
      2,
      { query: 'explicit', provider: 'google', limit: 2 },
      expect.any(Object),
    );
    expect(injected.grep).toHaveBeenNthCalledWith(1, { query: 'configured', limit: 8 }, expect.any(Object));
    expect(injected.grep).toHaveBeenNthCalledWith(2, { query: 'explicit', limit: 3 }, expect.any(Object));
    expect(injected.ask).toHaveBeenNthCalledWith(1, { question: 'configured', limit: 7 }, expect.any(Object));
    expect(injected.ask).toHaveBeenNthCalledWith(2, { question: 'explicit', limit: 4 }, expect.any(Object));
  });

  it('rejects invalid input before service execution, including web_grep.provider', async () => {
    const injected = services();

    await expect(
      tool('web_grep').run({ cwd: cwd, services: injected }, { query: 'subject', provider: 'duckduckgo' }),
    ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    expect(injected.grep).not.toHaveBeenCalled();
  });

  it('rejects blank stash content while preserving meaningful surrounding whitespace', async () => {
    const injected = services();
    const definition = tool('web_stash');
    const base = { url: 'https://example.com/page', title: 'Page' };

    await expect(definition.run({ cwd, services: injected }, { ...base, content: ' \n\t ' })).rejects.toMatchObject({
      code: 'TOOL_INPUT_INVALID',
    });
    await definition.run({ cwd, services: injected }, { ...base, content: ' \n Body \n ' });

    expect(injected.stash).toHaveBeenCalledWith({ ...base, content: ' \n Body \n ' }, expect.objectContaining({ cwd }));
  });

  it('enforces configured UTF-8, result-count, and serialized output bounds', async () => {
    const injected = services();
    const bounded = {
      cwd: cwd,
      services: injected,
      configOverrides: {
        security: {
          limits: { max_query_bytes: 3, max_results: 1, max_result_bytes: 30 },
        },
      },
    };

    await expect(tool('web_search').run(bounded, { query: '   x' })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      paths: ['query'],
    });
    await expect(tool('web_search').run(bounded, { query: 'éé' })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });

    const overflowing: SearchableServices = {
      ...injected,
      search: vi.fn(async () => ({
        results: [
          { title: 'First', url: 'https://example.com/1', snippet: '' },
          { title: 'Second', url: 'https://example.com/2', snippet: '' },
        ],
      })),
    };
    await expect(tool('web_search').run({ ...bounded, services: overflowing }, { query: 'ok' })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });
  });

  it('enforces configured URL and title UTF-8 bounds before service execution', async () => {
    const injected = services();
    const input = { url: 'https://example.com', title: 'éé', content: 'Body' };
    await expect(
      tool('web_stash').run(
        {
          cwd: cwd,
          services: injected,
          configOverrides: { security: { limits: { max_url_bytes: 10 } } },
        },
        input,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED', paths: ['url'] });
    await expect(
      tool('web_stash').run(
        {
          cwd: cwd,
          services: injected,
          configOverrides: { security: { limits: { max_url_bytes: 100, max_title_bytes: 3 } } },
        },
        input,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED', paths: ['title'] });
    expect(injected.stash).not.toHaveBeenCalled();
  });

  it('rejects invalid service output and content that exceeds a configured byte cap', async () => {
    const invalid: SearchableServices = {
      ...services(),
      fetch: vi.fn(async () => ({ title: '', content: 'Body', url: 'https://example.com', source: 'direct' })),
    };
    await expect(
      tool('web_fetch').run({ cwd: cwd, services: invalid }, { url: 'https://example.com' }),
    ).rejects.toMatchObject({ code: 'TOOL_OUTPUT_INVALID' });

    const oversized: SearchableServices = {
      ...services(),
      fetch: vi.fn(async () => ({
        title: 'Page',
        content: 'éé',
        url: 'https://example.com',
        source: 'direct',
      })),
    };
    await expect(
      tool('web_fetch').run(
        {
          cwd: cwd,
          services: oversized,
          configOverrides: { security: { limits: { max_content_bytes: 3 } } },
        },
        { url: 'https://example.com' },
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' });
  });

  it('enforces the configured aggregate result bound after output validation', async () => {
    const injected = services();
    await expect(
      tool('web_fetch').run(
        {
          cwd: cwd,
          services: injected,
          configOverrides: { security: { limits: { max_result_bytes: 10 } } },
        },
        { url: 'https://example.com' },
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' });
  });

  it('propagates cancellation and prevents calls for an already-aborted signal', async () => {
    const injected = services();
    const controller = new AbortController();
    controller.abort();

    await expect(
      tool('web_search').run(
        {
          cwd: cwd,
          services: injected,
          signal: controller.signal,
          configOverrides: { search: { limit: 0 } },
        },
        { query: 'subject' },
      ),
    ).rejects.toMatchObject({ category: 'cancelled', code: 'OPERATION_CANCELLED' });
    expect(injected.search).not.toHaveBeenCalled();
  });

  it('redacts resolved credentials and URL secrets from service failures', async () => {
    const injected: SearchableServices = {
      ...services(),
      search: vi.fn(async () => {
        throw new Error('request secret-token failed at https://user:password@example.com/path?api_key=secret-token');
      }),
    };

    let failure: unknown;
    try {
      await tool('web_search').run(
        {
          cwd: cwd,
          services: injected,
          configOverrides: { search: { credentials: { brave_api_key: 'secret-token' } } },
        },
        { query: 'subject' },
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SearchableError);
    expect((failure as Error).message).not.toMatch(/secret-token|password|api_key/u);
    expect((failure as Error).message).toContain('https://example.com/path');
  });

  it('redacts percent-encoded credentials from diagnostic URL paths', async () => {
    const credential = 'key/part';
    const partiallyEncoded = '%6bey%2Fpart';
    const fullyEncoded = '%6B%65%79%2f%70%61%72%74';
    const injected: SearchableServices = {
      ...services(),
      search: vi.fn(async () => {
        throw new Error(`failed at https://example.com/${partiallyEncoded} and https://example.com/${fullyEncoded}`);
      }),
    };

    let failure: unknown;
    try {
      await tool('web_search').run(
        {
          cwd,
          services: injected,
          configOverrides: { search: { credentials: { brave_api_key: credential } } },
        },
        { query: 'subject' },
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SearchableError);
    expect((failure as Error).message).not.toContain(partiallyEncoded);
    expect((failure as Error).message).not.toContain(fullyEncoded);
    expect((failure as Error).message).toContain('https://example.com/<redacted>');
  });

  it('recursively redacts every serialized field of structured service errors', async () => {
    const secret = 'secret-token';
    const details: Record<string, unknown> = {
      [secret]: 'first',
      '<redacted>': 'second',
      'https://user:password@example.com/path?api_key=secret-token': {
        nested: secret,
        nonfinite: Number.POSITIVE_INFINITY,
        absent: undefined,
      },
    };
    details['self'] = details;
    const injected: SearchableServices = {
      ...services(),
      search: vi.fn(async () => {
        throw new SearchableError(
          'service',
          `REMOTE_${secret}`,
          `failed ${secret}`,
          [`https://user:password@example.com/path?api_key=${secret}`],
          details,
        );
      }),
    };

    let failure: unknown;
    try {
      await tool('web_search').run(
        {
          cwd,
          services: injected,
          configOverrides: { search: { credentials: { brave_api_key: secret } } },
        },
        { query: 'subject' },
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SearchableError);
    const serialized = serializeSearchableError(failure as SearchableError);
    const json = JSON.stringify(serialized);
    expect(json).not.toMatch(/secret-token|user:password|api_key/u);
    expect(serialized.code).toBe('REMOTE_<redacted>');
    expect(serialized.paths).toEqual(['https://example.com/path']);
    expect(serialized.details).toMatchObject({
      '<redacted>': 'first',
      '<redacted>#2': 'second',
      'https://example.com/path': { nested: '<redacted>', nonfinite: null, absent: null },
      self: '<circular>',
    });
  });

  it('does not invoke enumerable detail getters while sanitizing errors', async () => {
    const secret = 'getter-secret';
    let getterCalled = false;
    const details: Record<string, unknown> = {};
    Object.defineProperty(details, 'danger', {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error(`raw getter exception ${secret}`);
      },
    });
    const injected: SearchableServices = {
      ...services(),
      search: vi.fn(async () => {
        throw new SearchableError('service', 'REMOTE_FAILURE', 'Remote failure.', [], details);
      }),
    };

    let failure: unknown;
    try {
      await tool('web_search').run(
        {
          cwd,
          services: injected,
          configOverrides: { search: { credentials: { brave_api_key: secret } } },
        },
        { query: 'subject' },
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(getterCalled).toBe(false);
    expect(failure).toBeInstanceOf(SearchableError);
    const serialized = serializeSearchableError(failure as SearchableError);
    expect(serialized.details).toEqual({ danger: '<accessor>' });
    expect(JSON.stringify(serialized)).not.toMatch(/getter-secret|raw getter exception/u);
  });

  it('falls back to a fixed error when a details Proxy rejects traversal', async () => {
    const secret = 'proxy-secret';
    const details = new Proxy<Record<string, unknown>>(
      {},
      {
        ownKeys() {
          throw new Error(`raw proxy exception ${secret}`);
        },
      },
    );
    const injected: SearchableServices = {
      ...services(),
      search: vi.fn(async () => {
        throw new SearchableError('service', 'REMOTE_FAILURE', 'Remote failure.', [], details);
      }),
    };

    let failure: unknown;
    try {
      await tool('web_search').run(
        {
          cwd,
          services: injected,
          configOverrides: { search: { credentials: { brave_api_key: secret } } },
        },
        { query: 'subject' },
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SearchableError);
    const serialized = serializeSearchableError(failure as SearchableError);
    expect(serialized).toEqual({
      category: 'service',
      code: 'SERVICE_FAILED',
      message: 'Searchable service failed.',
      paths: [],
    });
    expect(JSON.stringify(serialized)).not.toMatch(/proxy-secret|raw proxy exception/u);
  });
});
