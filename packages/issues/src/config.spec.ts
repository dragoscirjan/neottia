import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigRegistry, defineConfigContribution, resolveConfig } from '@neottia/config';
import { validateRelativePath } from '@neottia/repository-store';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { z } from 'zod';
import {
  DEFAULT_ISSUE_SHARD_PATH,
  ISSUE_CONFIG_FILE_ENV,
  ISSUE_ENV_BINDINGS,
  ISSUE_LEGACY_CONFIG_FILE_ENV,
  ISSUE_SHARD_PATH_ENV,
  IssueStore,
  issueConfigContribution,
  issueConfigFilePatchSchema,
  issueConfigFileSchema,
  issueConfigSchema,
  loadIssueConfig,
  resolveIssueConfigFile,
} from './index.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'issues-config-'));
  roots.push(cwd);
  return cwd;
}

function writeConfig(cwd: string, config: unknown, file = '.neottia/config.yml'): string {
  const path = join(cwd, file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, stringify(config, { lineWidth: 0 }), 'utf8');
  return path;
}

const companionPatchSchema = z.object({ enabled: z.boolean().optional() }).strict();
const companionContribution = defineConfigContribution({
  id: 'companion',
  path: ['modules', 'companion'],
  filePatchSchema: companionPatchSchema,
  runtimePatchSchema: companionPatchSchema,
  resolvedSchema: z.object({ enabled: z.boolean() }).strict(),
  defaults: { enabled: false },
});

describe('Issues configuration contribution', () => {
  it('preserves every established default and limit', () => {
    expect(loadIssueConfig(fixture(), { env: {} })).toEqual({
      enabled: false,
      root: '.neottia/issues',
      prefix: 'issue-',
      retrieval: { limit: 20, max_bytes: 1024 * 1024 },
      cache: { max_age_ms: 300_000, stale_policy: 'prompt' },
      lock: { wait_ms: 10_000, stale_ms: 60_000 },
      security: {
        max_file_bytes: 1024 * 1024,
        max_files: 10_000,
        max_total_bytes: 64 * 1024 * 1024,
        max_batch_paths: 1000,
        max_query_bytes: 16 * 1024,
        max_query_rows: 10_000,
        max_result_bytes: 16 * 1024 * 1024,
      },
    });
  });

  it('applies explicit overrides over environment and the deprecated file shard', () => {
    const cwd = fixture();
    writeConfig(cwd, {
      version: 1,
      skills: { issues: { enabled: false, prefix: 'file-', retrieval: { limit: 2 } } },
    });

    const config = loadIssueConfig(cwd, {
      prefix: 'explicit-',
      env: {
        NEOTTIA_ISSUES_ENABLED: 'true',
        NEOTTIA_ISSUES_PREFIX: 'env-',
        NEOTTIA_ISSUES_RETRIEVAL_LIMIT: '7',
      },
    });

    expect(config.enabled).toBe(true);
    expect(config.prefix).toBe('explicit-');
    expect(config.retrieval.limit).toBe(7);
  });

  it('composes canonical global, project, and profile patches without injecting defaults', () => {
    const cwd = fixture();
    const globalFile = writeConfig(
      cwd,
      {
        version: 1,
        modules: { issues: { prefix: 'global-', retrieval: { limit: 3 }, lock: { wait_ms: 22 } } },
        profiles: { ci: { modules: { issues: { retrieval: { max_bytes: 4096 } } } } },
      },
      'global.yml',
    );
    writeConfig(cwd, {
      version: 1,
      modules: { issues: { retrieval: { limit: 5 }, lock: { stale_ms: 44 } } },
      profiles: { ci: { modules: { issues: { prefix: 'profile-' } } } },
    });

    const config = loadIssueConfig(cwd, {
      env: { NEOTTIA_GLOBAL_CONFIG_FILE: globalFile, NEOTTIA_PROFILE: 'ci' },
    });

    expect(config.prefix).toBe('profile-');
    expect(config.retrieval).toEqual({ limit: 5, max_bytes: 4096 });
    expect(config.lock).toEqual({ wait_ms: 22, stale_ms: 44 });
  });

  it('resolves a frozen shard from one shared multi-module snapshot for IssueStore', () => {
    const cwd = fixture();
    const projectFile = writeConfig(cwd, {
      version: 1,
      modules: { companion: { enabled: true }, issues: { enabled: true, prefix: 'shared-' } },
    });
    const registry = createConfigRegistry([issueConfigContribution, companionContribution]);
    const snapshot = resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile });
    const shard = snapshot.get(issueConfigContribution);
    const store = new IssueStore(shard, cwd);

    expect(snapshot.get(companionContribution).enabled).toBe(true);
    expect(store.config.prefix).toBe('shared-');
    expect(Object.isFrozen(shard.security)).toBe(true);
    expect(snapshot.toJSON()).toMatchObject({ modules: { issues: { enabled: true, prefix: 'shared-' } } });
  });

  it('preserves the standalone Issues-only file and arbitrary shard aliases', () => {
    const cwd = fixture();
    const custom = writeConfig(cwd, { version: 1, custom: { issueSettings: { enabled: true } } }, 'custom.yml');
    const env = {
      [ISSUE_LEGACY_CONFIG_FILE_ENV]: custom,
      [ISSUE_SHARD_PATH_ENV]: 'custom.issueSettings',
    } as NodeJS.ProcessEnv;

    expect(loadIssueConfig(cwd, { env }).enabled).toBe(true);
    expect(resolveIssueConfigFile(cwd, env)).toBe(custom);
    expect(resolveIssueConfigFile(cwd, { [ISSUE_CONFIG_FILE_ENV]: 'other.yml' })).toBe(join(cwd, 'other.yml'));
    expect(DEFAULT_ISSUE_SHARD_PATH).toBe('skills.issues');
    expect(() => loadIssueConfig(cwd, { env: { [ISSUE_SHARD_PATH_ENV]: 'bad..path' } })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_PATH' }),
    );
  });

  it('makes explicitly selected missing files fail through the compatibility error type', () => {
    const cwd = fixture();
    expect(() =>
      loadIssueConfig(cwd, { env: { [ISSUE_LEGACY_CONFIG_FILE_ENV]: join(cwd, 'missing.yml') } }),
    ).toThrowError(expect.objectContaining({ category: 'configuration', code: 'CONFIG_INVALID' }));
  });

  it('rejects malformed documents, duplicate shard locations, unknown keys, and unsafe roots', () => {
    const cwd = fixture();
    const file = writeConfig(cwd, { version: 1 });
    writeFileSync(file, 'version: 1\nskills: [unclosed\n', 'utf8');
    expect(() => loadIssueConfig(cwd, { env: {} })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_YAML_INVALID' }),
    );

    writeConfig(cwd, {
      version: 1,
      modules: { issues: { enabled: true } },
      skills: { issues: { enabled: false } },
    });
    expect(() => loadIssueConfig(cwd, { env: {} })).toThrow(/more than one owned path/u);

    writeConfig(cwd, { version: 1, modules: { issues: { surprise: true } } });
    expect(() => loadIssueConfig(cwd, { env: {} })).toThrow(/modules\.issues\.surprise/u);
    expect(() => loadIssueConfig(cwd, { env: {}, root: '../outside' })).toThrow(/modules\.issues\.root/u);
  });

  it('keeps runtime, file, generated-schema, and backend root constraints aligned', () => {
    const generated = issueConfigFileSchema.toJSONSchema() as {
      properties: { root: { allOf?: Array<{ pattern: string }>; pattern?: string } };
    };
    const published = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8')) as unknown;
    expect(published).toEqual(generated);
    expect(issueConfigContribution.filePatchSchema).toBe(issueConfigFilePatchSchema);
    expect(issueConfigFilePatchSchema.safeParse({ retrieval: { limit: 9 } }).success).toBe(true);

    const patterns = (generated.properties.root.allOf ?? [generated.properties.root]).map(
      ({ pattern }) => new RegExp(pattern ?? '', 'u'),
    );
    const valid = [
      '.neottia/issues',
      'issues',
      'nested/issues',
      '.neottia/cache-x',
      '.neottia/repository-store-backup',
    ];
    const invalid = [
      '.neottia',
      '.neottia/cache',
      '.neottia/cache/issues',
      '.neottia/repository-store',
      '.neottia/repository-store/issues',
      '.neottia/CACHE/issues',
      '.NEOTTIA/RePoSiToRy-StOrE',
      'issues.',
      'nested/issues.',
      '.',
      '..',
      '../outside',
      '/absolute',
      'a\\b',
      'docs:stream',
      'a<b',
      'CON',
      'nested/lpt9.txt',
    ];
    for (const root of valid) {
      expect(issueConfigSchema.safeParse({ root }).success).toBe(true);
      expect(issueConfigFileSchema.safeParse({ root }).success).toBe(true);
      expect(patterns.every((pattern) => pattern.test(root))).toBe(true);
      expect(validateRelativePath(root)).toBe(root);
    }
    for (const root of invalid) {
      expect(issueConfigSchema.safeParse({ root }).success).toBe(false);
      expect(issueConfigFileSchema.safeParse({ root }).success).toBe(false);
      expect(patterns.every((pattern) => pattern.test(root))).toBe(false);
    }
    for (const root of ['issues.', 'nested/issues.']) expect(() => validateRelativePath(root)).toThrow();
  });

  it('loads roots, prefixes, retrieval, cache, lock, and security limits through the shared resolver', () => {
    const cwd = fixture();
    writeConfig(cwd, {
      version: 1,
      modules: {
        issues: {
          enabled: true,
          root: 'work/issues',
          prefix: 'ticket-',
          retrieval: { limit: 8, max_bytes: 8192 },
          cache: { max_age_ms: 1234, stale_policy: 'fail' },
          lock: { wait_ms: 2345, stale_ms: 3456 },
          security: {
            max_file_bytes: 4096,
            max_files: 50,
            max_total_bytes: 65_536,
            max_batch_paths: 25,
            max_query_bytes: 2048,
            max_query_rows: 100,
            max_result_bytes: 32_768,
          },
        },
      },
    });

    expect(loadIssueConfig(cwd, { env: {} })).toMatchObject({
      enabled: true,
      root: 'work/issues',
      prefix: 'ticket-',
      retrieval: { limit: 8, max_bytes: 8192 },
      cache: { max_age_ms: 1234, stale_policy: 'fail' },
      lock: { wait_ms: 2345, stale_ms: 3456 },
      security: {
        max_file_bytes: 4096,
        max_files: 50,
        max_total_bytes: 65_536,
        max_batch_paths: 25,
        max_query_bytes: 2048,
        max_query_rows: 100,
        max_result_bytes: 32_768,
      },
    });
  });

  it('retains every environment binding and delegates coercion to the shared resolver', () => {
    expect(new Set(ISSUE_ENV_BINDINGS.map(([path]) => path)).size).toBe(ISSUE_ENV_BINDINGS.length);
    expect(ISSUE_ENV_BINDINGS.every(([, name]) => name.startsWith('NEOTTIA_ISSUES_'))).toBe(true);

    const config = loadIssueConfig(fixture(), {
      env: {
        NEOTTIA_ISSUES_ENABLED: ' 1 ',
        NEOTTIA_ISSUES_ROOT: 'env/issues',
        NEOTTIA_ISSUES_PREFIX: 'env-',
        NEOTTIA_ISSUES_RETRIEVAL_LIMIT: '7',
        NEOTTIA_ISSUES_RETRIEVAL_MAX_BYTES: '7000',
        NEOTTIA_ISSUES_CACHE_MAX_AGE_MS: '700',
        NEOTTIA_ISSUES_CACHE_STALE_POLICY: 'rebuild',
        NEOTTIA_ISSUES_LOCK_WAIT_MS: '701',
        NEOTTIA_ISSUES_LOCK_STALE_MS: '702',
        NEOTTIA_ISSUES_MAX_FILE_BYTES: '703',
        NEOTTIA_ISSUES_MAX_FILES: '704',
        NEOTTIA_ISSUES_MAX_TOTAL_BYTES: '705',
        NEOTTIA_ISSUES_MAX_BATCH_PATHS: '706',
        NEOTTIA_ISSUES_MAX_QUERY_BYTES: '707',
        NEOTTIA_ISSUES_MAX_QUERY_ROWS: '708',
        NEOTTIA_ISSUES_MAX_RESULT_BYTES: '709',
      },
    });
    expect(config).toMatchObject({
      enabled: true,
      root: 'env/issues',
      prefix: 'env-',
      retrieval: { limit: 7, max_bytes: 7000 },
      cache: { max_age_ms: 700, stale_policy: 'rebuild' },
      lock: { wait_ms: 701, stale_ms: 702 },
      security: {
        max_file_bytes: 703,
        max_files: 704,
        max_total_bytes: 705,
        max_batch_paths: 706,
        max_query_bytes: 707,
        max_query_rows: 708,
        max_result_bytes: 709,
      },
    });

    expect(() => loadIssueConfig(fixture(), { env: { NEOTTIA_ISSUES_ENABLED: 'sometimes' } })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_ENV' }),
    );
  });

  it('ignores unrelated roots only in the deprecated standalone wrapper', () => {
    const cwd = fixture();
    const projectFile = writeConfig(cwd, {
      version: 1,
      mcpServers: { anything: { command: 'x' } },
      modules: { memory: { enabled: true }, issues: { enabled: true } },
    });

    expect(loadIssueConfig(cwd, { env: {} }).enabled).toBe(true);
    const registry = createConfigRegistry([issueConfigContribution]);
    expect(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile })).toThrow(
      /Configuration resolution failed/u,
    );
  });
});
