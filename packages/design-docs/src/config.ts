import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { DesignDocsError } from './errors.js';

export const DESIGN_DOCS_CONFIG_FILE_ENV = 'NEOTTIA_CONFIG_FILE';
export const DESIGN_DOCS_MODULE_CONFIG_FILE_ENV = 'NEOTTIA_DESIGN_DOCS_CONFIG_FILE';
export const DESIGN_DOCS_SHARD_PATH_ENV = 'NEOTTIA_CONFIG_DESIGN_DOCS_PATH';
export const DEFAULT_DESIGN_DOCS_SHARD_PATH = 'skills.design_docs';
export const DEFAULT_DESIGN_DOCS_CONFIG_FILE = '.neottia/config.yml';
const SAFE_RELATIVE_PATH = /^(?!\.{1,2}(?:\/|$))(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!\/)(?![A-Za-z]:)[^\\\0\r\n]+$/u;

/** Strict resolved configuration for the filesystem-canonical v1 backend. */
export const designDocsConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    root: z
      .string()
      .min(1)
      .max(1024)
      .regex(SAFE_RELATIVE_PATH)
      .refine(
        (value) => value.split('/').every((part) => part && !part.endsWith('.') && !part.endsWith(' ')),
        'must use portable path components',
      )
      .refine((value) => !overlapsReservedPath(value), 'must not overlap .neottia/cache or .neottia/repository-store')
      .default('.neottia/design-docs'),
    retrieval: z
      .object({
        limit: z.number().int().min(1).max(200).default(20),
        snippet_bytes: z.number().int().min(64).max(16_384).default(512),
        all_versions: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
    cache: z
      .object({
        max_age_ms: z.number().int().nonnegative().default(300_000),
        stale_policy: z.enum(['prompt', 'rebuild', 'fail']).default('prompt'),
      })
      .strict()
      .prefault({}),
    security: z
      .object({
        limits: z
          .object({
            max_files: z.number().int().positive().default(2_000),
            max_versions: z.number().int().positive().default(100),
            max_file_bytes: z.number().int().positive().default(1_100_000),
            max_body_bytes: z.number().int().positive().default(1_000_000),
            max_frontmatter_bytes: z.number().int().positive().default(131_072),
            max_metadata_bytes: z.number().int().positive().default(65_536),
            max_aggregate_bytes: z
              .number()
              .int()
              .positive()
              .default(8 * 1024 * 1024),
            max_yaml_depth: z.number().int().positive().default(16),
            max_yaml_nodes: z.number().int().positive().default(2_048),
            max_metadata_keys: z.number().int().positive().default(256),
            max_journal_bytes: z
              .number()
              .int()
              .positive()
              .default(4 * 1024 * 1024),
            max_backup_bytes: z
              .number()
              .int()
              .positive()
              .default(32 * 1024 * 1024),
            max_query_bytes: z.number().int().positive().default(16_384),
            max_results: z.number().int().positive().max(1_000).default(200),
            max_result_bytes: z
              .number()
              .int()
              .positive()
              .default(4 * 1024 * 1024),
            max_import_bytes: z
              .number()
              .int()
              .positive()
              .default(64 * 1024 * 1024),
          })
          .strict()
          .prefault({}),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type DesignDocsConfig = z.infer<typeof designDocsConfigSchema>;
export type DesignDocsConfigInput = z.input<typeof designDocsConfigSchema>;
export type DesignDocsLimits = DesignDocsConfig['security']['limits'];

export const DESIGN_DOCS_ENV_BINDINGS: ReadonlyArray<{
  path: string;
  env: string;
  kind: 'boolean' | 'integer' | 'string';
}> = [
  { path: 'enabled', env: 'NEOTTIA_DESIGN_DOCS_ENABLED', kind: 'boolean' },
  { path: 'root', env: 'NEOTTIA_DESIGN_DOCS_ROOT', kind: 'string' },
  { path: 'retrieval.limit', env: 'NEOTTIA_DESIGN_DOCS_RETRIEVAL_LIMIT', kind: 'integer' },
  { path: 'retrieval.snippet_bytes', env: 'NEOTTIA_DESIGN_DOCS_SNIPPET_BYTES', kind: 'integer' },
  { path: 'retrieval.all_versions', env: 'NEOTTIA_DESIGN_DOCS_ALL_VERSIONS', kind: 'boolean' },
  { path: 'cache.max_age_ms', env: 'NEOTTIA_DESIGN_DOCS_CACHE_MAX_AGE_MS', kind: 'integer' },
  { path: 'cache.stale_policy', env: 'NEOTTIA_DESIGN_DOCS_CACHE_STALE_POLICY', kind: 'string' },
];

/** Loads `skills.design_docs` with override > environment > file > default precedence. */
export function loadDesignDocsConfig(
  cwd: string,
  options: Partial<DesignDocsConfigInput> & { env?: NodeJS.ProcessEnv } = {},
): DesignDocsConfig {
  const env = options.env ?? process.env;
  const configuredPath = env[DESIGN_DOCS_CONFIG_FILE_ENV] ?? env[DESIGN_DOCS_MODULE_CONFIG_FILE_ENV];
  const file = configuredPath ? resolve(cwd, configuredPath) : join(cwd, DEFAULT_DESIGN_DOCS_CONFIG_FILE);
  let shard: unknown = {};
  if (existsSync(file)) {
    const document = parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true, strict: true });
    if (document.errors.length || document.warnings.length)
      throw new DesignDocsError('configuration', 'CONFIG_YAML_INVALID', `Malformed configuration YAML: ${file}`);
    const root: unknown = document.toJS();
    if (!isRecord(root) || root['version'] !== 1)
      throw new DesignDocsError(
        'configuration',
        'CONFIG_VERSION_INVALID',
        `Configuration requires version: 1 (${file}).`,
      );
    let current: unknown = root;
    const path = env[DESIGN_DOCS_SHARD_PATH_ENV] ?? DEFAULT_DESIGN_DOCS_SHARD_PATH;
    if (!path || path.split('.').some((part) => !part))
      throw new DesignDocsError(
        'configuration',
        'CONFIG_SHARD_INVALID',
        'Design Docs shard path must be a non-empty dot-path.',
      );
    for (const segment of path.split('.')) {
      if (!isRecord(current))
        throw new DesignDocsError(
          'configuration',
          'CONFIG_SHARD_INVALID',
          `Config shard path collides with a non-mapping: ${path}`,
        );
      current = current[segment];
      if (current === undefined) break;
    }
    shard = current ?? {};
  }
  if (!isRecord(shard))
    throw new DesignDocsError('configuration', 'CONFIG_SHARD_INVALID', 'skills.design_docs must be a mapping.');
  const overlay: Record<string, unknown> = {};
  for (const binding of DESIGN_DOCS_ENV_BINDINGS) {
    const value = env[binding.env];
    if (value === undefined || value === '') continue;
    assign(overlay, binding.path, coerce(binding, value));
  }
  const { env: _env, ...explicit } = options;
  void _env;
  const result = designDocsConfigSchema.safeParse(deepMerge(shard, overlay, explicit));
  if (!result.success)
    throw new DesignDocsError(
      'configuration',
      'CONFIG_SCHEMA_INVALID',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
    );
  return result.data;
}

function overlapsReservedPath(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\/+$/u, '');
  return ['.neottia/cache', '.neottia/repository-store'].some(
    (reserved) =>
      normalized === reserved || normalized.startsWith(`${reserved}/`) || reserved.startsWith(`${normalized}/`),
  );
}

function coerce(binding: (typeof DESIGN_DOCS_ENV_BINDINGS)[number], value: string): unknown {
  if (binding.kind === 'boolean') {
    if (/^(?:true|1)$/iu.test(value)) return true;
    if (/^(?:false|0)$/iu.test(value)) return false;
    throw new DesignDocsError('configuration', 'CONFIG_ENV_INVALID', `${binding.env} must be a boolean.`);
  }
  if (binding.kind === 'integer') {
    if (!/^-?\d+$/u.test(value.trim()))
      throw new DesignDocsError('configuration', 'CONFIG_ENV_INVALID', `${binding.env} must be an integer.`);
    return Number(value);
  }
  return value;
}

function assign(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current[part])) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1) as string] = value;
}
function deepMerge(
  base: Record<string, unknown>,
  ...layers: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> {
  const result = structuredClone(base);
  for (const layer of layers)
    for (const [key, value] of Object.entries(layer))
      result[key] = isRecord(result[key]) && isRecord(value) ? deepMerge(result[key], value) : structuredClone(value);
  return result;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
