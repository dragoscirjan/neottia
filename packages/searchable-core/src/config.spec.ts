import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigRegistry, defineConfigContribution, resolveConfig } from '@neottia/config';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DEFAULT_SEARCHABLE_SHARD_PATH,
  SEARCHABLE_CONFIG_FILE_ENV,
  SEARCHABLE_ENV_BINDINGS,
  SEARCHABLE_MODULE_CONFIG_FILE_ENV,
  SEARCHABLE_SHARD_PATH_ENV,
  loadSearchableConfig,
  resolveConfigFile,
  resolveShardPath,
  searchableConfigContribution,
  searchableConfigFilePatchSchema,
  searchableConfigFileSchema,
} from './config.js';

const roots: string[] = [];

/** Creates an isolated project without mutating the repository under test. */
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'neottia-searchable-config-'));
  roots.push(root);
  return root;
}

/** Writes one versioned Neottia config fixture. */
async function writeConfig(root: string, content: string, file = '.neottia/config.yml'): Promise<string> {
  const path = join(root, file);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
  return path;
}

const companionContribution = defineConfigContribution({
  defaults: { enabled: false },
  filePatchSchema: z.object({ enabled: z.boolean().optional() }).strict(),
  id: 'companion',
  path: ['modules', 'companion'],
  resolvedSchema: z.object({ enabled: z.boolean() }).strict(),
  runtimePatchSchema: z.object({ enabled: z.boolean().optional() }).strict(),
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Searchable configuration contribution', () => {
  it('preserves every provider, fetch, grep, ask, Ollama, cache, and security default', async () => {
    expect(loadSearchableConfig(await project(), { env: {} })).toEqual({
      enabled: false,
      root: '.neottia/searchable',
      search: {
        provider: 'duckduckgo',
        limit: 5,
        credentials: {},
        bing_api_endpoint: 'https://api.bing.microsoft.com/v7.0/search',
      },
      fetch: {
        strategies: ['direct', 'jina', 'wayback'],
        timeout_ms: 10_000,
        overall_timeout_ms: 20_000,
        max_response_bytes: 10 * 1024 * 1024,
      },
      grep: { limit: 5, snippet_bytes: 512 },
      ask: { limit: 3, context_bytes: 128 * 1024 },
      ollama: { endpoint: 'http://localhost:11434', model: 'llama3', timeout_ms: 60_000 },
      cache: { max_age_ms: 300_000, stale_policy: 'prompt' },
      security: {
        limits: {
          max_query_bytes: 16 * 1024,
          max_url_bytes: 8 * 1024,
          max_title_bytes: 4 * 1024,
          max_content_bytes: 10 * 1024 * 1024,
          max_results: 100,
          max_result_bytes: 4 * 1024 * 1024,
          max_storage_bytes: 256 * 1024 * 1024,
        },
      },
    });
  });

  it('loads every established setting through the shared project shard', async () => {
    const root = await project();
    await writeConfig(
      root,
      `version: 1
modules:
  searchable:
    enabled: true
    root: work/searchable
    search:
      provider: bing
      limit: 6
      bing_api_endpoint: https://example.com/search
    fetch:
      strategies: [direct, wayback]
      timeout_ms: 11000
      overall_timeout_ms: 22000
      max_response_bytes: 900000
    grep:
      limit: 7
      snippet_bytes: 700
    ask:
      limit: 8
      context_bytes: 9000
    ollama:
      endpoint: http://example.com:11434
      model: qwen
      timeout_ms: 33000
    cache:
      max_age_ms: 44000
      stale_policy: fail
    security:
      limits:
        max_query_bytes: 1000
        max_url_bytes: 1001
        max_title_bytes: 1002
        max_content_bytes: 1003
        max_results: 9
        max_result_bytes: 1004
        max_storage_bytes: 1005
`,
    );

    expect(loadSearchableConfig(root, { env: {} })).toMatchObject({
      enabled: true,
      root: 'work/searchable',
      search: { provider: 'bing', limit: 6, bing_api_endpoint: 'https://example.com/search' },
      fetch: {
        strategies: ['direct', 'wayback'],
        timeout_ms: 11_000,
        overall_timeout_ms: 22_000,
        max_response_bytes: 900_000,
      },
      grep: { limit: 7, snippet_bytes: 700 },
      ask: { limit: 8, context_bytes: 9000 },
      ollama: { endpoint: 'http://example.com:11434', model: 'qwen', timeout_ms: 33_000 },
      cache: { max_age_ms: 44_000, stale_policy: 'fail' },
      security: {
        limits: {
          max_query_bytes: 1000,
          max_url_bytes: 1001,
          max_title_bytes: 1002,
          max_content_bytes: 1003,
          max_results: 9,
          max_result_bytes: 1004,
          max_storage_bytes: 1005,
        },
      },
    });
  });

  it('applies explicit overrides over environment and the deprecated file shard', async () => {
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

  it('composes global, project, and profile patches without injecting defaults', async () => {
    const root = await project();
    const globalFile = await writeConfig(
      root,
      'version: 1\nmodules:\n  searchable:\n    fetch:\n      timeout_ms: 12000\n    grep:\n      snippet_bytes: 700\nprofiles:\n  ci:\n    modules:\n      searchable:\n        search:\n          limit: 11\n',
      'global.yml',
    );
    await writeConfig(
      root,
      'version: 1\nmodules:\n  searchable:\n    search:\n      provider: google\n    fetch:\n      overall_timeout_ms: 24000\nprofiles:\n  ci:\n    modules:\n      searchable:\n        grep:\n          limit: 12\n',
    );

    const config = loadSearchableConfig(root, {
      env: { NEOTTIA_GLOBAL_CONFIG_FILE: globalFile, NEOTTIA_PROFILE: 'ci' },
    });

    expect(config.search).toMatchObject({ provider: 'google', limit: 11 });
    expect(config.fetch).toMatchObject({ timeout_ms: 12_000, overall_timeout_ms: 24_000 });
    expect(config.grep).toMatchObject({ limit: 12, snippet_bytes: 700 });
  });

  it('provides one immutable, redacted shard from a shared multi-module snapshot', async () => {
    const root = await project();
    const projectFile = await writeConfig(
      root,
      "version: 1\nmodules:\n  companion:\n    enabled: true\n  searchable:\n    enabled: true\n    search:\n      credentials:\n        google_api_key: '${SEARCH_KEY}'\n",
    );
    const registry = createConfigRegistry([searchableConfigContribution, companionContribution]);
    const snapshot = resolveConfig(registry, {
      cwd: root,
      env: { SEARCH_KEY: '${SECOND_KEY}', SECOND_KEY: 'must-not-be-used' },
      globalFile: false,
      projectFile,
    });
    const searchable = snapshot.get(searchableConfigContribution);

    expect(snapshot.get(companionContribution).enabled).toBe(true);
    expect(searchable.search.credentials.google_api_key).toBe('${SECOND_KEY}');
    expect(Object.isFrozen(searchable.fetch)).toBe(true);
    expect(snapshot.toJSON()).toMatchObject({
      modules: { searchable: { search: { credentials: { google_api_key: '[REDACTED]' } } } },
    });
    expect(
      JSON.stringify(snapshot.sourceOf(searchableConfigContribution, ['search', 'credentials', 'google_api_key'])),
    ).not.toContain('${SECOND_KEY}');
  });

  it('preserves standalone file and arbitrary shard aliases', async () => {
    const root = await project();
    const custom = await writeConfig(root, 'version: 1\ncustom:\n  web:\n    enabled: true\n', 'custom.yml');
    const env = {
      [SEARCHABLE_MODULE_CONFIG_FILE_ENV]: custom,
      [SEARCHABLE_SHARD_PATH_ENV]: 'custom.web',
    };

    expect(loadSearchableConfig(root, { env }).enabled).toBe(true);
    expect(resolveConfigFile(root, env)).toBe(custom);
    expect(resolveConfigFile(root, { [SEARCHABLE_CONFIG_FILE_ENV]: 'other.yml' })).toBe(join(root, 'other.yml'));
    expect(DEFAULT_SEARCHABLE_SHARD_PATH).toBe('skills.searchable');
    expect(resolveShardPath()).toBe(DEFAULT_SEARCHABLE_SHARD_PATH);
    expect(() => resolveShardPath({ [SEARCHABLE_SHARD_PATH_ENV]: 'bad..path' })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_SHARD_INVALID' }),
    );
  });

  it('retains canonical and legacy environment aliases in their documented precedence', async () => {
    expect(new Set(SEARCHABLE_ENV_BINDINGS.flatMap(({ names }) => names))).toEqual(
      new Set([
        'NEOTTIA_SEARCHABLE_ENABLED',
        'NEOTTIA_SEARCHABLE_ROOT',
        'NEOTTIA_SEARCHABLE_PROVIDER',
        'NEOTTIA_SEARCHABLE_SEARCH_LIMIT',
        'NEOTTIA_SEARCHABLE_GOOGLE_API_KEY',
        'GOOGLE_API_KEY',
        'NEOTTIA_SEARCHABLE_GOOGLE_CSE_ID',
        'GOOGLE_CSE_ID',
        'NEOTTIA_SEARCHABLE_BING_API_KEY',
        'BING_API_KEY',
        'NEOTTIA_SEARCHABLE_BRAVE_API_KEY',
        'BRAVE_API_KEY',
        'NEOTTIA_SEARCHABLE_BING_API_ENDPOINT',
        'BING_API_ENDPOINT',
        'NEOTTIA_SEARCHABLE_GREP_LIMIT',
        'NEOTTIA_SEARCHABLE_ASK_LIMIT',
        'NEOTTIA_SEARCHABLE_OLLAMA_URL',
        'OLLAMA_URL',
        'NEOTTIA_SEARCHABLE_OLLAMA_MODEL',
        'OLLAMA_MODEL',
      ]),
    );

    const config = loadSearchableConfig(await project(), {
      env: {
        NEOTTIA_SEARCHABLE_ENABLED: 'true',
        NEOTTIA_SEARCHABLE_GOOGLE_API_KEY: 'canonical-key',
        GOOGLE_API_KEY: 'legacy-key',
        OLLAMA_MODEL: 'qwen',
        NEOTTIA_SEARCHABLE_FETCH_FALLBACK: 'false',
        WEB_FETCH_FALLBACK: 'true',
      },
    });
    expect(config).toMatchObject({
      enabled: true,
      search: { credentials: { google_api_key: 'canonical-key' } },
      fetch: { strategies: ['direct'] },
      ollama: { model: 'qwen' },
    });
    expect(() =>
      loadSearchableConfig(rootForError(), { env: { NEOTTIA_SEARCHABLE_FETCH_FALLBACK: 'sometimes' } }),
    ).toThrowError(expect.objectContaining({ code: 'CONFIG_ENV_INVALID' }));
  });

  it('allows only exact file credential references and trusted runtime literals', async () => {
    const root = await project();
    await writeConfig(
      root,
      "version: 1\nmodules:\n  searchable:\n    search:\n      credentials:\n        brave_api_key: '${FILE_KEY}'\n",
    );

    expect(loadSearchableConfig(root, { env: { FILE_KEY: 'resolved-secret' } }).search.credentials).toEqual({
      brave_api_key: 'resolved-secret',
    });
    expect(
      loadSearchableConfig(await project(), {
        env: {},
        search: { credentials: { brave_api_key: 'trusted-literal' } },
      }).search.credentials.brave_api_key,
    ).toBe('trusted-literal');
    expect(
      loadSearchableConfig(await project(), {
        env: { FIRST_KEY: '${SECOND_KEY}', SECOND_KEY: 'must-not-be-used' },
        search: { credentials: { brave_api_key: '${FIRST_KEY}' } },
      }).search.credentials.brave_api_key,
    ).toBe('${SECOND_KEY}');
    expect(() => searchableConfigFileSchema.parse({ search: { credentials: { brave_api_key: 'literal' } } })).toThrow();
  });

  it('publishes the standalone file schema and default-free contribution patch schema', async () => {
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
    expect(searchableConfigContribution.filePatchSchema).toBe(searchableConfigFilePatchSchema);
    expect(searchableConfigFilePatchSchema.parse({ grep: { limit: 9 } })).toEqual({ grep: { limit: 9 } });
    expect(searchProperties['bing_api_endpoint']).toMatchObject({
      format: 'uri',
      pattern: '^[hH][tT][tT][pP][sS]?:\\/\\/',
    });
    expect(ollamaProperties['endpoint']).toMatchObject({
      format: 'uri',
      pattern: '^[hH][tT][tT][pP][sS]?:\\/\\/',
    });
    expect(fetchProperties['strategies']?.['uniqueItems']).toBe(true);
  });

  it('translates shared file, YAML, version, collision, schema, and secret diagnostics', async () => {
    const missing = await project();
    for (const name of [SEARCHABLE_CONFIG_FILE_ENV, SEARCHABLE_MODULE_CONFIG_FILE_ENV]) {
      expect(() => loadSearchableConfig(missing, { env: { [name]: 'missing.yml' } })).toThrowError(
        expect.objectContaining({ code: 'CONFIG_READ_FAILED' }),
      );
    }

    const root = await project();
    const file = await writeConfig(root, 'version: 1\n');
    await writeFile(file, 'version: 1\nmodules: [unclosed\n', 'utf8');
    expect(() => loadSearchableConfig(root, { env: {} })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_YAML_INVALID' }),
    );

    await writeConfig(root, 'version: 2\n');
    expect(() => loadSearchableConfig(root, { env: {} })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_VERSION_INVALID' }),
    );
    await writeConfig(
      root,
      'version: 1\nmodules:\n  searchable:\n    enabled: true\nskills:\n  searchable:\n    enabled: false\n',
    );
    expect(() => loadSearchableConfig(root, { env: {} })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_SHARD_INVALID' }),
    );
    await writeConfig(root, 'version: 1\nmodules:\n  searchable:\n    surprise: true\n');
    expect(() => loadSearchableConfig(root, { env: {} })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_SCHEMA_INVALID' }),
    );
    await writeConfig(
      root,
      "version: 1\nmodules:\n  searchable:\n    search:\n      credentials:\n        brave_api_key: '${MISSING}'\n",
    );
    expect(() => loadSearchableConfig(root, { env: {} })).toThrowError(
      expect.objectContaining({ code: 'CREDENTIAL_REFERENCE_UNSET' }),
    );
  });

  it('ignores unrelated roots only in the deprecated standalone wrapper', async () => {
    const root = await project();
    const projectFile = await writeConfig(
      root,
      'version: 1\nmcpServers:\n  anything:\n    command: x\nmodules:\n  memory:\n    enabled: true\n  searchable:\n    enabled: true\n',
    );

    expect(loadSearchableConfig(root, { env: {} }).enabled).toBe(true);
    const registry = createConfigRegistry([searchableConfigContribution]);
    expect(() => resolveConfig(registry, { cwd: root, env: {}, globalFile: false, projectFile })).toThrow(
      /Configuration resolution failed/u,
    );
  });
});

/** Supplies a fresh synchronous path for expected wrapper failures. */
function rootForError(): string {
  return join(tmpdir(), `neottia-searchable-error-${crypto.randomUUID()}`);
}
