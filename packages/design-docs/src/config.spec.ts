import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createConfigRegistry,
  defineConfigContribution,
  generateConfigJsonSchema,
  resolveConfig,
} from '@neottia/config';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { z } from 'zod';
import {
  DEFAULT_DESIGN_DOCS_SHARD_PATH,
  DESIGN_DOCS_CONFIG_FILE_ENV,
  DESIGN_DOCS_ENV_BINDINGS,
  DESIGN_DOCS_MODULE_CONFIG_FILE_ENV,
  DESIGN_DOCS_SHARD_PATH_ENV,
  designDocsConfigContribution,
  designDocsConfigFilePatchSchema,
  designDocsConfigFileSchema,
  designDocsConfigSchema,
  loadDesignDocsConfig,
  resolveDesignDocsConfigFile,
} from './config.js';

const roots = new Set<string>();
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'design-docs-config-'));
  roots.add(directory);
  return directory;
}

/** Evaluates the generated string bounds used by the root-path schemas. */
function generatedStringSchemaAccepts(schema: Record<string, unknown>, value: string): boolean {
  if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) return false;
  if (typeof schema['maxLength'] === 'number' && value.length > schema['maxLength']) return false;
  if (typeof schema['pattern'] === 'string' && !new RegExp(schema['pattern'], 'u').test(value)) return false;
  if (Array.isArray(schema['allOf'])) {
    return schema['allOf'].every(
      (part) => typeof part === 'object' && part !== null && generatedStringSchemaAccepts(part, value),
    );
  }
  return true;
}

function writeConfig(cwd: string, config: unknown, file = '.neottia/config.yml'): string {
  const destination = join(cwd, file);
  mkdirSync(join(destination, '..'), { recursive: true });
  writeFileSync(destination, stringify(config, { lineWidth: 0 }), 'utf8');
  return destination;
}

const companionPatchSchema = z.object({ mode: z.enum(['off', 'on']).optional() }).strict();
const companionContribution = defineConfigContribution({
  id: 'design-docs-companion',
  path: ['modules', 'design_docs_companion'],
  filePatchSchema: companionPatchSchema,
  runtimePatchSchema: companionPatchSchema,
  resolvedSchema: z.object({ mode: z.enum(['off', 'on']) }).strict(),
  defaults: { mode: 'off' },
});

describe('Design Docs configuration contribution', () => {
  it('preserves every established default and security limit', () => {
    expect(loadDesignDocsConfig(fixture(), { env: {} })).toEqual({
      enabled: false,
      root: '.neottia/design-docs',
      retrieval: { limit: 20, snippet_bytes: 512, all_versions: false },
      cache: { max_age_ms: 300_000, stale_policy: 'prompt' },
      security: {
        limits: {
          max_files: 2_000,
          max_versions: 100,
          max_file_bytes: 1_100_000,
          max_body_bytes: 1_000_000,
          max_frontmatter_bytes: 131_072,
          max_metadata_bytes: 65_536,
          max_aggregate_bytes: 8 * 1024 * 1024,
          max_yaml_depth: 16,
          max_yaml_nodes: 2_048,
          max_metadata_keys: 256,
          max_journal_bytes: 4 * 1024 * 1024,
          max_backup_bytes: 32 * 1024 * 1024,
          max_query_bytes: 16_384,
          max_results: 200,
          max_result_bytes: 4 * 1024 * 1024,
          max_import_bytes: 64 * 1024 * 1024,
        },
      },
    });
  });

  it('applies explicit overrides over environment and the deprecated file shard', () => {
    const cwd = fixture();
    writeConfig(cwd, {
      version: 1,
      skills: { design_docs: { enabled: false, retrieval: { limit: 9 } } },
    });

    const config = loadDesignDocsConfig(cwd, {
      retrieval: { limit: 5 },
      env: {
        NEOTTIA_DESIGN_DOCS_ENABLED: 'true',
        NEOTTIA_DESIGN_DOCS_RETRIEVAL_LIMIT: '7',
      },
    });

    expect(config.enabled).toBe(true);
    expect(config.retrieval).toEqual({ limit: 5, snippet_bytes: 512, all_versions: false });
  });

  it('composes canonical global, project, and profile patches without injecting defaults', () => {
    const cwd = fixture();
    const globalFile = writeConfig(
      cwd,
      {
        version: 1,
        modules: {
          design_docs: { root: 'global-docs', retrieval: { limit: 3 }, cache: { max_age_ms: 22 } },
        },
        profiles: { ci: { modules: { design_docs: { retrieval: { snippet_bytes: 256 } } } } },
      },
      'global.yml',
    );
    writeConfig(cwd, {
      version: 1,
      modules: { design_docs: { retrieval: { limit: 5 }, cache: { stale_policy: 'fail' } } },
      profiles: { ci: { modules: { design_docs: { root: 'profile-docs' } } } },
    });

    const config = loadDesignDocsConfig(cwd, {
      env: { NEOTTIA_GLOBAL_CONFIG_FILE: globalFile, NEOTTIA_PROFILE: 'ci' },
    });

    expect(config.root).toBe('profile-docs');
    expect(config.retrieval).toEqual({ limit: 5, snippet_bytes: 256, all_versions: false });
    expect(config.cache).toEqual({ max_age_ms: 22, stale_policy: 'fail' });
  });

  it('resolves a frozen shard from one shared multi-module snapshot', () => {
    const cwd = fixture();
    const projectFile = writeConfig(cwd, {
      version: 1,
      modules: {
        design_docs_companion: { mode: 'on' },
        design_docs: { enabled: true, root: 'shared-docs' },
      },
    });
    const registry = createConfigRegistry([designDocsConfigContribution, companionContribution]);
    const snapshot = resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile });
    const shard = snapshot.get(designDocsConfigContribution);

    expect(snapshot.get(companionContribution).mode).toBe('on');
    expect(shard.root).toBe('shared-docs');
    expect(Object.isFrozen(shard.security.limits)).toBe(true);
    expect(snapshot.toJSON()).toMatchObject({ modules: { design_docs: { enabled: true } } });
  });

  it('preserves standalone Design Docs-only file and arbitrary shard aliases', () => {
    const cwd = fixture();
    const custom = writeConfig(cwd, { version: 1, custom: { documentSettings: { enabled: true } } }, 'custom.yml');
    const env = {
      [DESIGN_DOCS_MODULE_CONFIG_FILE_ENV]: custom,
      [DESIGN_DOCS_SHARD_PATH_ENV]: 'custom.documentSettings',
    } as NodeJS.ProcessEnv;

    expect(loadDesignDocsConfig(cwd, { env }).enabled).toBe(true);
    expect(resolveDesignDocsConfigFile(cwd, env)).toBe(custom);
    expect(resolveDesignDocsConfigFile(cwd, { [DESIGN_DOCS_CONFIG_FILE_ENV]: 'other.yml' })).toBe(
      join(cwd, 'other.yml'),
    );
    expect(DEFAULT_DESIGN_DOCS_SHARD_PATH).toBe('skills.design_docs');
    expect(() => loadDesignDocsConfig(cwd, { env: { [DESIGN_DOCS_SHARD_PATH_ENV]: 'bad..path' } })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_SHARD_INVALID' }),
    );
  });

  it('makes explicitly selected missing files fail through the compatibility error type', () => {
    const cwd = fixture();
    expect(() =>
      loadDesignDocsConfig(cwd, {
        env: { [DESIGN_DOCS_MODULE_CONFIG_FILE_ENV]: join(cwd, 'missing.yml') },
      }),
    ).toThrowError(expect.objectContaining({ category: 'configuration', code: 'CONFIG_SCHEMA_INVALID' }));
  });

  it('rejects malformed documents, duplicate shard locations, unknown keys, and unsafe roots', () => {
    const cwd = fixture();
    const file = writeConfig(cwd, { version: 1 });
    writeFileSync(file, 'version: 1\nskills: [unclosed\n', 'utf8');
    expect(() => loadDesignDocsConfig(cwd, { env: {} })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_YAML_INVALID' }),
    );

    writeConfig(cwd, {
      version: 1,
      modules: { design_docs: { enabled: true } },
      skills: { design_docs: { enabled: false } },
    });
    expect(() => loadDesignDocsConfig(cwd, { env: {} })).toThrow(/more than one owned path/u);

    writeConfig(cwd, { version: 1, modules: { design_docs: { remote_provider: 'github' } } });
    expect(() => loadDesignDocsConfig(cwd, { env: {} })).toThrow(/modules\.design_docs\.remote_provider/u);
    expect(() => loadDesignDocsConfig(cwd, { env: {}, root: '../outside' })).toThrow(/modules\.design_docs\.root/u);
    for (const root of ['.neottia', '.neottia/cache', '.neottia/cache/docs', '.neottia/repository-store/docs'])
      expect(() => loadDesignDocsConfig(cwd, { env: {}, root })).toThrow(/modules\.design_docs\.root/u);
  });

  it('keeps runtime, file, generated-schema, and contribution schemas aligned', () => {
    const generated = designDocsConfigFileSchema.toJSONSchema({ io: 'input' }) as Record<string, unknown>;
    const published = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8')) as unknown;
    expect(published).toEqual(generated);
    expect(designDocsConfigContribution.filePatchSchema).toBe(designDocsConfigFilePatchSchema);
    expect(designDocsConfigFilePatchSchema.safeParse({ retrieval: { limit: 9 } }).success).toBe(true);

    const standaloneRoot = (generated['properties'] as Record<string, Record<string, unknown>>)['root'];
    const complete = generateConfigJsonSchema(createConfigRegistry([designDocsConfigContribution]));
    const completeRoot = (
      ((complete['properties'] as Record<string, unknown>)['modules'] as Record<string, unknown>)[
        'properties'
      ] as Record<string, Record<string, unknown>>
    )['design_docs']['properties'] as Record<string, Record<string, unknown>>;
    const completeRootSchema = completeRoot['root'];
    const candidates = [
      ['nested/docs', true],
      ['.neottia/cache', false],
      ['docs.', false],
      ['docs:stream', false],
      ['CON', false],
      ['nested/lpt9.txt', false],
    ] as const;
    for (const [root, accepted] of candidates) {
      expect(designDocsConfigSchema.safeParse({ root }).success).toBe(accepted);
      expect(generatedStringSchemaAccepts(standaloneRoot, root)).toBe(accepted);
      expect(generatedStringSchemaAccepts(completeRootSchema, root)).toBe(accepted);
    }
  });

  it('loads paths, retrieval, cache, and every security limit through the shared resolver', () => {
    const cwd = fixture();
    writeConfig(cwd, {
      version: 1,
      modules: {
        design_docs: {
          enabled: true,
          root: 'work/docs',
          retrieval: { limit: 8, snippet_bytes: 640, all_versions: true },
          cache: { max_age_ms: 1234, stale_policy: 'fail' },
          security: {
            limits: {
              max_files: 11,
              max_versions: 12,
              max_file_bytes: 13,
              max_body_bytes: 14,
              max_frontmatter_bytes: 15,
              max_metadata_bytes: 16,
              max_aggregate_bytes: 17,
              max_yaml_depth: 18,
              max_yaml_nodes: 19,
              max_metadata_keys: 20,
              max_journal_bytes: 21,
              max_backup_bytes: 22,
              max_query_bytes: 23,
              max_results: 24,
              max_result_bytes: 25,
              max_import_bytes: 26,
            },
          },
        },
      },
    });

    expect(loadDesignDocsConfig(cwd, { env: {} })).toMatchObject({
      enabled: true,
      root: 'work/docs',
      retrieval: { limit: 8, snippet_bytes: 640, all_versions: true },
      cache: { max_age_ms: 1234, stale_policy: 'fail' },
      security: { limits: { max_files: 11, max_results: 24, max_import_bytes: 26 } },
    });
  });

  it('retains every established environment binding and delegates coercion', () => {
    expect(new Set(DESIGN_DOCS_ENV_BINDINGS.map(({ path }) => path)).size).toBe(DESIGN_DOCS_ENV_BINDINGS.length);
    expect(DESIGN_DOCS_ENV_BINDINGS.every(({ env }) => env.startsWith('NEOTTIA_DESIGN_DOCS_'))).toBe(true);

    const config = loadDesignDocsConfig(fixture(), {
      env: {
        NEOTTIA_DESIGN_DOCS_ENABLED: ' 1 ',
        NEOTTIA_DESIGN_DOCS_ROOT: 'env/docs',
        NEOTTIA_DESIGN_DOCS_RETRIEVAL_LIMIT: '7',
        NEOTTIA_DESIGN_DOCS_SNIPPET_BYTES: '700',
        NEOTTIA_DESIGN_DOCS_ALL_VERSIONS: 'true',
        NEOTTIA_DESIGN_DOCS_CACHE_MAX_AGE_MS: '701',
        NEOTTIA_DESIGN_DOCS_CACHE_STALE_POLICY: 'rebuild',
      },
    });
    expect(config).toMatchObject({
      enabled: true,
      root: 'env/docs',
      retrieval: { limit: 7, snippet_bytes: 700, all_versions: true },
      cache: { max_age_ms: 701, stale_policy: 'rebuild' },
    });
    expect(() => loadDesignDocsConfig(fixture(), { env: { NEOTTIA_DESIGN_DOCS_ENABLED: 'sometimes' } })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_ENV_INVALID' }),
    );
  });

  it('ignores unrelated roots only in the deprecated standalone wrapper', () => {
    const cwd = fixture();
    const projectFile = writeConfig(cwd, {
      version: 1,
      mcpServers: { anything: { command: 'x' } },
      modules: { memory: { enabled: true }, design_docs: { enabled: true } },
    });

    expect(loadDesignDocsConfig(cwd, { env: {} }).enabled).toBe(true);
    const registry = createConfigRegistry([designDocsConfigContribution]);
    expect(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile })).toThrow(
      /Configuration resolution failed/u,
    );
  });
});
