import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSearchableConfig, searchableConfigFileSchema } from './config.js';
import { SearchableError } from './errors.js';

const roots: string[] = [];

/** Creates an isolated project without mutating the repository under test. */
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'neottia-searchable-config-'));
  roots.push(root);
  return root;
}

/** Writes the project-local versioned Neottia config fixture. */
async function writeConfig(root: string, content: string): Promise<void> {
  await mkdir(join(root, '.neottia'), { recursive: true });
  await writeFile(join(root, '.neottia', 'config.yml'), content, 'utf8');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('loadSearchableConfig', () => {
  it('preserves required defaults', async () => {
    const config = loadSearchableConfig(await project(), { env: {} });

    expect(config).toMatchObject({
      enabled: false,
      root: '.neottia/searchable',
      search: { provider: 'duckduckgo', limit: 5 },
      fetch: { strategies: ['direct', 'jina', 'wayback'] },
      grep: { limit: 5 },
      ask: { limit: 3 },
      ollama: { endpoint: 'http://localhost:11434', model: 'llama3' },
    });
  });

  it('applies explicit overrides over canonical env, file, and defaults', async () => {
    const root = await project();
    await writeConfig(
      root,
      'version: 1\nskills:\n  searchable:\n    search:\n      provider: google\n      limit: 7\n',
    );

    const config = loadSearchableConfig(root, {
      env: { NEOTTIA_SEARCHABLE_PROVIDER: 'bing', NEOTTIA_SEARCHABLE_SEARCH_LIMIT: '8' },
      search: { provider: 'brave', limit: 9 },
    });

    expect(config.search.provider).toBe('brave');
    expect(config.search.limit).toBe(9);
  });

  it('supports a configured shard path and legacy environment aliases', async () => {
    const root = await project();
    await writeConfig(root, 'version: 1\nmodules:\n  web:\n    enabled: true\n');

    const config = loadSearchableConfig(root, {
      env: {
        NEOTTIA_CONFIG_SEARCHABLE_PATH: 'modules.web',
        OLLAMA_MODEL: 'qwen',
        WEB_FETCH_FALLBACK: 'false',
      },
    });

    expect(config.enabled).toBe(true);
    expect(config.ollama.model).toBe('qwen');
    expect(config.fetch.strategies).toEqual(['direct']);
  });

  it('allows only credential references in YAML and resolves them', async () => {
    const root = await project();
    await writeConfig(
      root,
      "version: 1\nskills:\n  searchable:\n    search:\n      credentials:\n        google_api_key: '${SEARCH_KEY}'\n",
    );

    expect(loadSearchableConfig(root, { env: { SEARCH_KEY: 'resolved-secret' } }).search.credentials).toEqual({
      google_api_key: 'resolved-secret',
    });
    expect(() =>
      searchableConfigFileSchema.parse({ search: { credentials: { google_api_key: 'literal' } } }),
    ).toThrow();
  });

  it('gives canonical credential env names priority over legacy aliases and file references', async () => {
    const root = await project();
    await writeConfig(
      root,
      "version: 1\nskills:\n  searchable:\n    search:\n      credentials:\n        brave_api_key: '${FILE_KEY}'\n",
    );

    const config = loadSearchableConfig(root, {
      env: {
        FILE_KEY: 'from-file-reference',
        BRAVE_API_KEY: 'legacy',
        NEOTTIA_SEARCHABLE_BRAVE_API_KEY: 'canonical',
      },
    });

    expect(config.search.credentials.brave_api_key).toBe('canonical');
  });

  it('keeps the published schema aligned with runtime-only HTTP and uniqueness constraints', async () => {
    const generated = searchableConfigFileSchema.toJSONSchema({ io: 'input' }) as Record<string, unknown>;
    const published = JSON.parse(await readFile(new URL('../config.schema.json', import.meta.url), 'utf8')) as Record<
      string,
      unknown
    >;
    const rootProperties = generated['properties'] as Record<string, Record<string, unknown>>;
    const searchProperties = rootProperties['search']?.['properties'] as Record<string, Record<string, unknown>>;
    const fetchProperties = rootProperties['fetch']?.['properties'] as Record<string, Record<string, unknown>>;
    const ollamaProperties = rootProperties['ollama']?.['properties'] as Record<string, Record<string, unknown>>;

    expect(published).toEqual(generated);
    expect(searchProperties['bing_api_endpoint']).toMatchObject({
      format: 'uri',
      pattern: '^[hH][tT][tT][pP][sS]?:\\/\\/',
    });
    expect(ollamaProperties['endpoint']).toMatchObject({
      format: 'uri',
      pattern: '^[hH][tT][tT][pP][sS]?:\\/\\/',
    });
    expect(fetchProperties['strategies']?.['uniqueItems']).toBe(true);
    expect(ollamaProperties['model']?.['pattern']).toBe('\\S');
    expect(() => searchableConfigFileSchema.parse({ ollama: { endpoint: 'ftp://example.com' } })).toThrow();
    expect(() => searchableConfigFileSchema.parse({ ollama: { model: '   ' } })).toThrow();
    expect(() => searchableConfigFileSchema.parse({ fetch: { strategies: ['direct', 'direct'] } })).toThrow();
  });

  it('rejects a missing explicitly selected configuration file', async () => {
    const root = await project();

    for (const name of ['NEOTTIA_CONFIG_FILE', 'NEOTTIA_SEARCHABLE_CONFIG_FILE']) {
      let failure: unknown;
      try {
        loadSearchableConfig(root, { env: { [name]: 'missing.yml' } });
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toMatchObject({ category: 'configuration', code: 'CONFIG_READ_FAILED' });
    }
  });

  it('strictly rejects unknown keys, wrong versions, and invalid limits', async () => {
    const unknown = await project();
    await writeConfig(unknown, 'version: 1\nskills:\n  searchable:\n    surprise: true\n');
    expect(() => loadSearchableConfig(unknown, { env: {} })).toThrow(SearchableError);

    const version = await project();
    await writeConfig(version, 'version: 2\nskills: {}\n');
    expect(() => loadSearchableConfig(version, { env: {} })).toThrowError(/version: 1/u);

    expect(() =>
      loadSearchableConfig(version, {
        env: { NEOTTIA_CONFIG_FILE: 'missing.yml' },
        security: { limits: { max_results: 101 } },
      }),
    ).toThrow(SearchableError);
  });
});
