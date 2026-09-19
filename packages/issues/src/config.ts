import { join, resolve } from 'node:path';
import {
  ConfigResolutionError,
  createCacheConfigPatchSchema,
  createCacheConfigSchema,
  createConfigRegistry,
  defineConfigContribution,
  resolveConfig,
  type ConfigDiagnosticCode,
} from '@neottia/config';
import { PORTABLE_RELATIVE_PATH_PATTERN } from '@neottia/repository-store';
import { z } from 'zod';
import { IssueError } from './errors.js';

/** Env var holding the project config location, checked before the Issues-only alias. */
export const ISSUE_CONFIG_FILE_ENV = 'NEOTTIA_CONFIG_FILE';
/** Deprecated Issues-only project config location. */
export const ISSUE_LEGACY_CONFIG_FILE_ENV = 'NEOTTIA_ISSUES_CONFIG_FILE';
/** Deprecated env var overriding the path of the Issues shard. */
export const ISSUE_SHARD_PATH_ENV = 'NEOTTIA_CONFIG_ISSUES_PATH';
/** Deprecated shard path retained by the standalone compatibility wrapper. */
export const DEFAULT_ISSUE_SHARD_PATH = 'skills.issues';
/** Default project config location, relative to the working directory. */
export const DEFAULT_ISSUE_CONFIG_FILE = '.neottia/config.yml';

const ALLOWED_ISSUES_ROOT_PATTERN =
  /^(?!\.[nN][eE][oO][tT][tT][iI][aA](?:$|\/(?:[cC][aA][cC][hH][eE]|[rR][eE][pP][oO][sS][iI][tT][oO][rR][yY]-[sS][tT][oO][rR][eE])(?:\/|$))).+$/u;
const ISSUE_ROOT_CHARACTERS_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
// These expressions survive JSON Schema generation and keep configured roots
// aligned with repository-store checks without widening the existing grammar.
const relativeRoot = z
  .string()
  .min(1)
  .max(1024)
  .regex(PORTABLE_RELATIVE_PATH_PATTERN, 'must use portable path components')
  .regex(ISSUE_ROOT_CHARACTERS_PATTERN, 'must use letters, numbers, dots, underscores, hyphens, and slashes')
  .regex(ALLOWED_ISSUES_ROOT_PATTERN, 'must not overlap reserved .neottia paths');
const positive = z.number().int().positive();

/** Complete strict runtime schema for resolved config and direct IssueStore values. */
export const issueConfigSchema = createResolvedIssueConfigSchema();
/** Complete default-bearing schema used by standalone YAML shard tooling. */
export const issueConfigFileSchema = createResolvedIssueConfigSchema();
/** Default-free schema applied independently to every YAML and profile source layer. */
export const issueConfigFilePatchSchema = createIssueConfigPatchSchema();
/** Default-free schema applied to trusted explicit runtime override layers. */
export const issueConfigRuntimePatchSchema = createIssueConfigPatchSchema();

/** Builds the complete Issues schema while preserving all established defaults and limits. */
function createResolvedIssueConfigSchema() {
  return z
    .object({
      enabled: z.boolean().default(false),
      root: relativeRoot.default('.neottia/issues'),
      prefix: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,31}$/u)
        .default('issue-'),
      retrieval: z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          max_bytes: z
            .number()
            .int()
            .min(1024)
            .max(16 * 1024 * 1024)
            .default(1024 * 1024),
        })
        .prefault({}),
      cache: createCacheConfigSchema({ strict: false }),
      lock: z
        .object({ wait_ms: z.number().int().nonnegative().default(10_000), stale_ms: positive.default(60_000) })
        .prefault({}),
      security: z
        .object({
          max_file_bytes: positive.default(1024 * 1024),
          max_files: positive.default(10_000),
          max_total_bytes: positive.default(64 * 1024 * 1024),
          max_batch_paths: positive.default(1000),
          max_query_bytes: positive.default(16 * 1024),
          max_query_rows: positive.default(10_000),
          max_result_bytes: positive.default(16 * 1024 * 1024),
        })
        .prefault({}),
    })
    .strict();
}

/** Builds a deep optional source schema without allowing one layer to inject defaults. */
function createIssueConfigPatchSchema() {
  return z
    .object({
      enabled: z.boolean().optional(),
      root: relativeRoot.optional(),
      prefix: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,31}$/u)
        .optional(),
      retrieval: z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          max_bytes: z
            .number()
            .int()
            .min(1024)
            .max(16 * 1024 * 1024)
            .optional(),
        })
        .strict()
        .optional(),
      cache: createCacheConfigPatchSchema(),
      lock: z
        .object({ wait_ms: z.number().int().nonnegative().optional(), stale_ms: positive.optional() })
        .strict()
        .optional(),
      security: z
        .object({
          max_file_bytes: positive.optional(),
          max_files: positive.optional(),
          max_total_bytes: positive.optional(),
          max_batch_paths: positive.optional(),
          max_query_bytes: positive.optional(),
          max_query_rows: positive.optional(),
          max_result_bytes: positive.optional(),
        })
        .strict()
        .optional(),
    })
    .strict();
}

export type IssueConfig = z.output<typeof issueConfigSchema>;
export type IssueConfigInput = z.input<typeof issueConfigSchema>;
export type LoadIssueConfigOptions = Partial<IssueConfigInput> & { env?: NodeJS.ProcessEnv };

/** Every supported env leaf, retained in its established public tuple format. */
export const ISSUE_ENV_BINDINGS = [
  ['enabled', 'NEOTTIA_ISSUES_ENABLED', 'boolean'],
  ['root', 'NEOTTIA_ISSUES_ROOT', 'string'],
  ['prefix', 'NEOTTIA_ISSUES_PREFIX', 'string'],
  ['retrieval.limit', 'NEOTTIA_ISSUES_RETRIEVAL_LIMIT', 'integer'],
  ['retrieval.max_bytes', 'NEOTTIA_ISSUES_RETRIEVAL_MAX_BYTES', 'integer'],
  ['cache.max_age_ms', 'NEOTTIA_ISSUES_CACHE_MAX_AGE_MS', 'integer'],
  ['cache.stale_policy', 'NEOTTIA_ISSUES_CACHE_STALE_POLICY', 'string'],
  ['lock.wait_ms', 'NEOTTIA_ISSUES_LOCK_WAIT_MS', 'integer'],
  ['lock.stale_ms', 'NEOTTIA_ISSUES_LOCK_STALE_MS', 'integer'],
  ['security.max_file_bytes', 'NEOTTIA_ISSUES_MAX_FILE_BYTES', 'integer'],
  ['security.max_files', 'NEOTTIA_ISSUES_MAX_FILES', 'integer'],
  ['security.max_total_bytes', 'NEOTTIA_ISSUES_MAX_TOTAL_BYTES', 'integer'],
  ['security.max_batch_paths', 'NEOTTIA_ISSUES_MAX_BATCH_PATHS', 'integer'],
  ['security.max_query_bytes', 'NEOTTIA_ISSUES_MAX_QUERY_BYTES', 'integer'],
  ['security.max_query_rows', 'NEOTTIA_ISSUES_MAX_QUERY_ROWS', 'integer'],
  ['security.max_result_bytes', 'NEOTTIA_ISSUES_MAX_RESULT_BYTES', 'integer'],
] as const;

/** Complete defaults contributed at the lowest shared-resolution precedence. */
const ISSUE_CONFIG_DEFAULTS: IssueConfig = issueConfigSchema.parse({});

/** Issues' typed contribution to a shared multi-module configuration registry. */
export const issueConfigContribution = defineConfigContribution({
  id: 'issues',
  path: ['modules', 'issues'],
  legacyPaths: [['skills', 'issues']],
  filePatchSchema: issueConfigFilePatchSchema,
  runtimePatchSchema: issueConfigRuntimePatchSchema,
  resolvedSchema: issueConfigSchema,
  defaults: ISSUE_CONFIG_DEFAULTS,
  environment: ISSUE_ENV_BINDINGS.map(([path, name, kind]) => ({
    kind,
    names: [name],
    path: path.split('.'),
  })),
});

/**
 * Resolves Issues through @neottia/config while retaining deprecated standalone
 * file and shard aliases. Shared hosts should register issueConfigContribution
 * once alongside their other modules instead.
 */
export function loadIssueConfig(cwd: string, options: LoadIssueConfigOptions = {}): IssueConfig {
  const env = options.env ?? process.env;
  const contribution = compatibilityContribution(env);
  const registry = createConfigRegistry([contribution]);
  const { env: _envOption, ...issueOverrides } = options;
  void _envOption;

  try {
    const snapshot = resolveConfig(registry, {
      compatibility: { ignoreUnregisteredPaths: true },
      cwd,
      env,
      overrides: { modules: { issues: issueOverrides } },
      // The shared file variable is discovered by the resolver; this preserves the Issues-only fallback.
      projectFile:
        env[ISSUE_CONFIG_FILE_ENV] === undefined && env[ISSUE_LEGACY_CONFIG_FILE_ENV] !== undefined
          ? resolveIssueConfigFile(cwd, env)
          : undefined,
    });
    return snapshot.get(contribution) as IssueConfig;
  } catch (error) {
    if (!(error instanceof ConfigResolutionError)) throw error;
    throw translateResolutionError(error);
  }
}

/** Returns the resolved project config file path for diagnostics and compatibility hosts. */
export function resolveIssueConfigFile(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[ISSUE_CONFIG_FILE_ENV] ?? env[ISSUE_LEGACY_CONFIG_FILE_ENV];
  return configured ? resolve(cwd, configured) : join(cwd, DEFAULT_ISSUE_CONFIG_FILE);
}

/** Builds a contribution that recognizes one deprecated arbitrary standalone shard path. */
function compatibilityContribution(env: NodeJS.ProcessEnv): typeof issueConfigContribution {
  const shardPath = resolveIssueShardPath(env).split('.');
  if (
    pathsEqual(shardPath, issueConfigContribution.path) ||
    issueConfigContribution.legacyPaths?.some((path) => pathsEqual(path, shardPath)) === true
  ) {
    return issueConfigContribution;
  }
  return defineConfigContribution({
    ...issueConfigContribution,
    legacyPaths: [shardPath],
  }) as typeof issueConfigContribution;
}

/** Validates the deprecated standalone shard-path override before registration. */
function resolveIssueShardPath(env: NodeJS.ProcessEnv): string {
  const configured = env[ISSUE_SHARD_PATH_ENV];
  if (configured !== undefined && (!configured.trim() || configured.split('.').some((part) => !part))) {
    throw new IssueError(`${ISSUE_SHARD_PATH_ENV} must be a non-empty dot-path.`, 'configuration', 'CONFIG_PATH');
  }
  return configured ?? DEFAULT_ISSUE_SHARD_PATH;
}

/** Translates value-free shared diagnostics into the established IssueError surface. */
function translateResolutionError(error: ConfigResolutionError): IssueError {
  const first = error.diagnostics[0];
  const code = resolutionIssueCode(first?.code);
  const details = error.diagnostics.map((diagnostic) => {
    const path = diagnostic.path === undefined ? '' : ` at ${diagnostic.path.join('.')}`;
    const environment = diagnostic.source?.environment === undefined ? '' : ` (${diagnostic.source.environment})`;
    const file = diagnostic.source?.file === undefined ? '' : ` in ${diagnostic.source.file}`;
    return `${diagnostic.message}${path}${environment}${file}`;
  });
  return new IssueError(`Invalid issues config: ${details.join('; ')}`, 'configuration', code, {
    cause: error,
    details: {
      diagnostics: error.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        ...(diagnostic.path === undefined ? {} : { path: diagnostic.path.join('.') }),
      })),
    },
  });
}

/** Keeps historical configuration error codes where shared categories have direct equivalents. */
function resolutionIssueCode(code: ConfigDiagnosticCode | undefined): string {
  if (code === 'YAML') return 'CONFIG_YAML_INVALID';
  if (code === 'VERSION') return 'CONFIG_VERSION';
  if (code === 'PATH' || code === 'MERGE') return 'CONFIG_PATH';
  if (code === 'ENVIRONMENT') return 'CONFIG_ENV';
  return 'CONFIG_INVALID';
}

/** Compares configuration paths without interpreting dots inside segments. */
function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
