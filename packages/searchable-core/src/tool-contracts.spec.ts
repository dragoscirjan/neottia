import { describe, expect, it } from 'vitest';
import { searchableToolJsonSchema, searchableToolSchemas } from './tool-contracts.js';

/** Reads a generated object property's schema with a clear test assertion boundary. */
function property(schema: Record<string, unknown>, name: string): Record<string, unknown> {
  const properties = schema['properties'] as Record<string, Record<string, unknown>>;
  return properties[name] as Record<string, unknown>;
}

/** Contract tests pin the externally visible five-name compatibility surface. */
describe('searchableToolSchemas', () => {
  it('contains exactly the five approved names', () => {
    expect(Object.keys(searchableToolSchemas)).toEqual(['web_search', 'web_fetch', 'web_stash', 'web_grep', 'web_ask']);
  });

  it('parses omitted configurable fields without resolving them and rejects unknown fields', () => {
    expect(searchableToolSchemas.web_search.input.parse({ query: '  flowers  ' })).toEqual({
      query: 'flowers',
    });
    expect(searchableToolSchemas.web_grep.input.parse({ query: 'cache' })).toEqual({ query: 'cache' });
    expect(searchableToolSchemas.web_ask.input.parse({ question: 'why?' })).toEqual({ question: 'why?' });
    expect(() => searchableToolSchemas.web_grep.input.parse({ query: 'cache', provider: 'duckduckgo' })).toThrow();
  });

  it('rejects non-HTTP URLs and blank stash content at runtime', () => {
    expect(() => searchableToolSchemas.web_fetch.input.parse({ url: 'file:///etc/passwd' })).toThrow();
    expect(() =>
      searchableToolSchemas.web_stash.input.parse({
        url: 'https://example.com',
        title: 'Page',
        content: ' \n\t ',
      }),
    ).toThrow();
  });

  it('emits public defaults and runtime constraints in generated input schemas', () => {
    const search = searchableToolJsonSchema('web_search', 'input');
    const fetch = searchableToolJsonSchema('web_fetch', 'input');
    const stash = searchableToolJsonSchema('web_stash', 'input');

    expect(property(search, 'provider')['default']).toBe('duckduckgo');
    expect(property(search, 'limit')['default']).toBe(5);
    expect(search['required']).toEqual(['query']);
    expect(property(search, 'query')['pattern']).toBe('\\S');
    expect(property(fetch, 'url')).toMatchObject({
      format: 'uri',
      pattern: '^[hH][tT][tT][pP][sS]?:\\/\\/',
    });
    expect(property(stash, 'title')['pattern']).toBe('\\S');
    expect(property(stash, 'content')['pattern']).toBe('\\S');
  });

  it('keeps every generated output object-rooted', () => {
    for (const name of Object.keys(searchableToolSchemas) as (keyof typeof searchableToolSchemas)[]) {
      const schema = searchableToolJsonSchema(name, 'output');
      expect(schema['type']).toBe('object');
    }
  });
});
