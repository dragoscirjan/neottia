import { join, resolve } from 'node:path';
import {
  ConfigResolutionError,
  createConfigRegistry,
  defineConfigContribution,
  resolveConfig,
  type ConfigDiagnosticCode,
} from '@neottia/config';
import { PORTABLE_RELATIVE_PATH_PATTERN } from '@neottia/repository-store';
import { z } from 'zod';
import { DesignDocsError } from './errors.js';

/** Env var holding the project config location, checked before the Design Docs-only alias. */
export const DESIGN_DOCS_CONFIG_FILE_ENV = 'NEOTTIA_CONFIG_FILE';
/** Deprecated Design Docs-only project config location. */
export const DESIGN_DOCS_MODULE_CONFIG_FILE_ENV = 'NEOTTIA_DESIGN_DOCS_CONFIG_FILE';
/** Deprecated env var overriding the path of the Design Docs shard. */
export const DESIGN_DOCS_SHARD_PATH_ENV = 'NEOTTIA_CONFIG_DESIGN_DOCS_PATH';
/** Deprecated shard path retained by the standalone compatibility wrapper. */
export const DEFAULT_DESIGN_DOCS_SHARD_PATH = 'skills.design_docs';
/** Default project config location, relative to the working directory. */
export const DEFAULT_DESIGN_DOCS_CONFIG_FILE = '.neottia/config.yml';

const ALLOWED_DESIGN_DOCS_ROOT_PATTERN =
  /^(?!\.[nN][eE][oO][tT][tT][iI][aA](?:$|\/(?:[cC][aA][cC][hH][eE]|[rR][eE][pP][oO][sS][iI][tT][oO][rR][yY]-[sS][tT][oO][rR][eE])(?:\/|$))).+$/u;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/u;
const positive = z.number().int().positive();

/** Complete strict runtime schema for resolved config and direct store values. */
export const designDocsConfigSchema = createResolvedDesignDocsConfigSchema();
/** Complete default-bearing schema used by standalone YAML shard tooling. */
export const designDocsConfigFileSchema = createResolvedDesignDocsConfigSchema();
/** Default-free schema applied independently to every YAML and profile source layer. */
export const designDocsConfigFilePatchSchema = createDesignDocsConfigPatchSchema();
/** Default-free schema applied to trusted explicit runtime override layers. */
export const designDocsConfigRuntimePatchSchema = createDesignDocsConfigPatchSchema();

/** Builds the complete Design Docs schema while preserving established defaults and limits. */
function createResolvedDesignDocsConfigSchema() {
  return z
    .object({
      enabled: z.boolean().default(false),
      root: designDocsRootSchema().default('.neottia/design-docs'),
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
              max_files: positive.default(2_000),
              max_versions: positive.default(100),
              max_file_bytes: positive.default(1_100_000),
              max_body_bytes: positive.default(1_000_000),
              max_frontmatter_bytes: positive.default(131_072),
              max_metadata_bytes: positive.default(65_536),
              max_aggregate_bytes: positive.default(8 * 1024 * 1024),
              max_yaml_depth: positive.default(16),
              max_yaml_nodes: positive.default(2_048),
              max_metadata_keys: positive.default(256),
              max_journal_bytes: positive.default(4 * 1024 * 1024),
              max_backup_bytes: positive.default(32 * 1024 * 1024),
              max_query_bytes: positive.default(16_384),
              max_results: positive.max(1_000).default(200),
              max_result_bytes: positive.default(4 * 1024 * 1024),
              max_import_bytes: positive.default(64 * 1024 * 1024),
            })
            .strict()
            .prefault({}),
        })
        .strict()
        .prefault({}),
    })
    .strict();
}

/** Builds a deep optional source schema without allowing one layer to inject defaults. */
function createDesignDocsConfigPatchSchema() {
  return z
    .object({
      enabled: z.boolean().optional(),
      root: designDocsRootSchema().optional(),
      retrieval: z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
          snippet_bytes: z.number().int().min(64).max(16_384).optional(),
          all_versions: z.boolean().optional(),
        })
        .strict()
        .optional(),
      cache: z
        .object({
          max_age_ms: z.number().int().nonnegative().optional(),
          stale_policy: z.enum(['prompt', 'rebuild', 'fail']).optional(),
        })
        .strict()
        .optional(),
      security: z
        .object({
          limits: z
            .object({
              max_files: positive.optional(),
              max_versions: positive.optional(),
              max_file_bytes: positive.optional(),
              max_body_bytes: positive.optional(),
              max_frontmatter_bytes: positive.optional(),
              max_metadata_bytes: positive.optional(),
              max_aggregate_bytes: positive.optional(),
              max_yaml_depth: positive.optional(),
              max_yaml_nodes: positive.optional(),
              max_metadata_keys: positive.optional(),
              max_journal_bytes: positive.optional(),
              max_backup_bytes: positive.optional(),
              max_query_bytes: positive.optional(),
              max_results: positive.max(1_000).optional(),
              max_result_bytes: positive.optional(),
              max_import_bytes: positive.optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict();
}

/** Returns schema-visible portable and reserved-path constraints. */
function designDocsRootSchema() {
  return z
    .string()
    .min(1)
    .max(1024)
    .regex(PRINTABLE_ASCII_PATTERN, 'must contain only printable ASCII characters')
    .regex(PORTABLE_RELATIVE_PATH_PATTERN, 'must use portable path components')
    .regex(ALLOWED_DESIGN_DOCS_ROOT_PATTERN, 'must not overlap reserved .neottia paths')
    .refine((value) => !overlapsReservedPath(value), 'must not normalize to a reserved .neottia path');
}

export type DesignDocsConfig = z.output<typeof designDocsConfigSchema>;
export type DesignDocsConfigInput = z.input<typeof designDocsConfigSchema>;
export type DesignDocsLimits = DesignDocsConfig['security']['limits'];
export type LoadDesignDocsConfigOptions = Partial<DesignDocsConfigInput> & { env?: NodeJS.ProcessEnv };

/** Every supported environment leaf, retained in its established public object format. */
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

/** Complete defaults contributed at the lowest shared-resolution precedence. */
const DESIGN_DOCS_CONFIG_DEFAULTS: DesignDocsConfig = designDocsConfigSchema.parse({});

/** Design Docs' typed contribution to a shared multi-module configuration registry. */
export const designDocsConfigContribution = defineConfigContribution({
  id: 'design-docs',
  path: ['modules', 'design_docs'],
  legacyPaths: [['skills', 'design_docs']],
  filePatchSchema: designDocsConfigFilePatchSchema,
  runtimePatchSchema: designDocsConfigRuntimePatchSchema,
  resolvedSchema: designDocsConfigSchema,
  defaults: DESIGN_DOCS_CONFIG_DEFAULTS,
  environment: DESIGN_DOCS_ENV_BINDINGS.map(({ path, env, kind }) => ({
    kind,
    names: [env],
    path: path.split('.'),
  })),
});

/**
 * Resolves Design Docs through @neottia/config while retaining deprecated
 * standalone file and shard aliases. Shared hosts should register the
 * contribution once alongside their other modules instead.
 */
export function loadDesignDocsConfig(cwd: string, options: LoadDesignDocsConfigOptions = {}): DesignDocsConfig {
  const env = options.env ?? process.env;
  const contribution = compatibilityContribution(env);
  const registry = createConfigRegistry([contribution]);
  const { env: _envOption, ...designDocsOverrides } = options;
  void _envOption;

  try {
    const snapshot = resolveConfig(registry, {
      compatibility: { ignoreUnregisteredPaths: true },
      cwd,
      env,
      overrides: { modules: { design_docs: designDocsOverrides } },
      // Shared discovery handles NEOTTIA_CONFIG_FILE; retain the domain-only fallback here.
      projectFile:
        env[DESIGN_DOCS_CONFIG_FILE_ENV] === undefined && env[DESIGN_DOCS_MODULE_CONFIG_FILE_ENV] !== undefined
          ? resolveDesignDocsConfigFile(cwd, env)
          : undefined,
    });
    return snapshot.get(contribution) as DesignDocsConfig;
  } catch (error) {
    if (!(error instanceof ConfigResolutionError)) throw error;
    throw translateResolutionError(error);
  }
}

/** Returns the resolved project config file path for diagnostics and compatibility hosts. */
export function resolveDesignDocsConfigFile(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[DESIGN_DOCS_CONFIG_FILE_ENV] ?? env[DESIGN_DOCS_MODULE_CONFIG_FILE_ENV];
  return configured ? resolve(cwd, configured) : join(cwd, DEFAULT_DESIGN_DOCS_CONFIG_FILE);
}

/** Builds a contribution that recognizes one deprecated arbitrary standalone shard path. */
function compatibilityContribution(env: NodeJS.ProcessEnv): typeof designDocsConfigContribution {
  const shardPath = resolveDesignDocsShardPath(env).split('.');
  if (
    pathsEqual(shardPath, designDocsConfigContribution.path) ||
    designDocsConfigContribution.legacyPaths?.some((path) => pathsEqual(path, shardPath)) === true
  ) {
    return designDocsConfigContribution;
  }
  return defineConfigContribution({
    ...designDocsConfigContribution,
    legacyPaths: [shardPath],
  }) as typeof designDocsConfigContribution;
}

/** Validates the deprecated standalone shard-path override before registration. */
function resolveDesignDocsShardPath(env: NodeJS.ProcessEnv): string {
  const configured = env[DESIGN_DOCS_SHARD_PATH_ENV];
  if (configured !== undefined && (!configured.trim() || configured.split('.').some((part) => !part))) {
    throw new DesignDocsError(
      'configuration',
      'CONFIG_SHARD_INVALID',
      `${DESIGN_DOCS_SHARD_PATH_ENV} must be a non-empty dot-path.`,
    );
  }
  return configured ?? DEFAULT_DESIGN_DOCS_SHARD_PATH;
}

/** Translates value-free shared diagnostics into the established DesignDocsError surface. */
function translateResolutionError(error: ConfigResolutionError): DesignDocsError {
  const first = error.diagnostics[0];
  const code = resolutionDesignDocsCode(first?.code);
  const messages = error.diagnostics.map((diagnostic) => {
    const path = diagnostic.path === undefined ? '' : ` at ${diagnostic.path.join('.')}`;
    const environment = diagnostic.source?.environment === undefined ? '' : ` (${diagnostic.source.environment})`;
    const file = diagnostic.source?.file === undefined ? '' : ` in ${diagnostic.source.file}`;
    return `${diagnostic.message}${path}${environment}${file}`;
  });
  return new DesignDocsError(
    'configuration',
    code,
    `Invalid Design Docs config: ${messages.join('; ')}`,
    [],
    {
      diagnostics: error.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        ...(diagnostic.path === undefined ? {} : { path: diagnostic.path.join('.') }),
      })),
    },
    { cause: error },
  );
}

/** Keeps historical configuration error codes where shared categories have direct equivalents. */
function resolutionDesignDocsCode(code: ConfigDiagnosticCode | undefined): string {
  if (code === 'YAML') return 'CONFIG_YAML_INVALID';
  if (code === 'VERSION') return 'CONFIG_VERSION_INVALID';
  if (code === 'PATH' || code === 'MERGE') return 'CONFIG_SHARD_INVALID';
  if (code === 'ENVIRONMENT') return 'CONFIG_ENV_INVALID';
  return 'CONFIG_SCHEMA_INVALID';
}

/** Rejects compatibility spellings that normalize to a reserved path. */
function overlapsReservedPath(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\/+$/u, '');
  return ['.neottia/cache', '.neottia/repository-store'].some(
    (reserved) =>
      normalized === reserved || normalized.startsWith(`${reserved}/`) || reserved.startsWith(`${normalized}/`),
  );
}

/** Compares configuration paths without interpreting dots inside segments. */
function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
