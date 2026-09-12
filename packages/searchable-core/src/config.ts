import { join, resolve } from 'node:path';
import {
  ConfigResolutionError,
  createConfigRegistry,
  defineConfigContribution,
  resolveConfig,
  type ConfigDiagnosticCode,
} from '@neottia/config';
import { z } from 'zod';
import { SearchableError } from './errors.js';
import { searchableHttpUrlSchema } from './schemas.js';

/** Shared project config-file override used by every Neottia module. */
export const SEARCHABLE_CONFIG_FILE_ENV = 'NEOTTIA_CONFIG_FILE';
/** Deprecated Searchable-only project config-file override. */
export const SEARCHABLE_MODULE_CONFIG_FILE_ENV = 'NEOTTIA_SEARCHABLE_CONFIG_FILE';
/** Deprecated environment override for the standalone Searchable shard dot-path. */
export const SEARCHABLE_SHARD_PATH_ENV = 'NEOTTIA_CONFIG_SEARCHABLE_PATH';
/** Deprecated shard path retained by the standalone compatibility wrapper. */
export const DEFAULT_SEARCHABLE_SHARD_PATH = 'skills.searchable';
/** Default repository-local configuration file. */
export const DEFAULT_SEARCHABLE_CONFIG_FILE = '.neottia/config.yml';

const CREDENTIAL_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u;
const SAFE_RELATIVE_PATH = /^(?!\.{1,2}(?:\/|$))(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!\/)(?![A-Za-z]:)[^\\\0\r\n]+$/u;
const nonblank = z.string().trim().min(1).regex(/\S/u, 'must not be blank');
const credentialValue = z.string().min(1);
const credentialReference = z.string().regex(CREDENTIAL_REFERENCE, 'must be an exact ${ENV_VAR} reference');
/** Creates one reusable positive-integer cap without changing its JSON Schema. */
const positiveIntegerAtMost = (maximum: number) => z.number().int().positive().max(maximum);
const fetchStrategies = z
  .array(z.enum(['direct', 'jina', 'wayback']))
  .min(1)
  .max(3)
  .refine((values) => new Set(values).size === values.length, 'strategies must be unique')
  .meta({ uniqueItems: true });

/** Creates complete file or runtime schemas while preserving all established defaults. */
function createSearchableConfigSchema(credential: z.ZodString) {
  return z
    .object({
      enabled: z.boolean().default(false),
      root: z.string().min(1).max(1024).regex(SAFE_RELATIVE_PATH).default('.neottia/searchable'),
      search: z
        .object({
          provider: z.enum(['duckduckgo', 'google', 'bing', 'brave']).default('duckduckgo'),
          limit: z.number().int().min(1).max(100).default(5),
          timeout_ms: z.number().int().positive().max(300_000).default(10_000),
          credentials: z
            .object({
              google_api_key: credential.optional(),
              google_cse_id: credential.optional(),
              bing_api_key: credential.optional(),
              brave_api_key: credential.optional(),
            })
            .strict()
            .prefault({}),
          bing_api_endpoint: searchableHttpUrlSchema.default('https://api.bing.microsoft.com/v7.0/search'),
        })
        .strict()
        .prefault({}),
      fetch: z
        .object({
          strategies: fetchStrategies.default(['direct', 'jina', 'wayback']),
          timeout_ms: positiveIntegerAtMost(300_000).default(10_000),
          overall_timeout_ms: positiveIntegerAtMost(600_000).default(20_000),
          max_response_bytes: positiveIntegerAtMost(10 * 1024 * 1024).default(10 * 1024 * 1024),
        })
        .strict()
        .prefault({}),
      grep: z
        .object({
          limit: z.number().int().min(1).max(100).default(5),
          snippet_bytes: z.number().int().min(64).max(16_384).default(512),
        })
        .strict()
        .prefault({}),
      ask: z
        .object({
          limit: z.number().int().min(1).max(100).default(3),
          context_bytes: z
            .number()
            .int()
            .min(256)
            .max(4 * 1024 * 1024)
            .default(128 * 1024),
        })
        .strict()
        .prefault({}),
      ollama: z
        .object({
          endpoint: searchableHttpUrlSchema.default('http://localhost:11434'),
          model: nonblank.default('llama3'),
          timeout_ms: positiveIntegerAtMost(600_000).default(60_000),
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
              max_query_bytes: positiveIntegerAtMost(16 * 1024).default(16 * 1024),
              max_url_bytes: positiveIntegerAtMost(8 * 1024).default(8 * 1024),
              max_title_bytes: positiveIntegerAtMost(4 * 1024).default(4 * 1024),
              max_content_bytes: positiveIntegerAtMost(10 * 1024 * 1024).default(10 * 1024 * 1024),
              max_results: positiveIntegerAtMost(100).default(100),
              max_result_bytes: positiveIntegerAtMost(4 * 1024 * 1024).default(4 * 1024 * 1024),
              max_storage_bytes: positiveIntegerAtMost(256 * 1024 * 1024).default(256 * 1024 * 1024),
            })
            .strict()
            .prefault({}),
        })
        .strict()
        .prefault({}),
    })
    .strict();
}

/** Creates a deep optional source schema without injecting defaults into a layer. */
function createSearchableConfigPatchSchema(credential: z.ZodString) {
  return z
    .object({
      enabled: z.boolean().optional(),
      root: z.string().min(1).max(1024).regex(SAFE_RELATIVE_PATH).optional(),
      search: z
        .object({
          provider: z.enum(['duckduckgo', 'google', 'bing', 'brave']).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          credentials: z
            .object({
              google_api_key: credential.optional(),
              google_cse_id: credential.optional(),
              bing_api_key: credential.optional(),
              brave_api_key: credential.optional(),
            })
            .strict()
            .optional(),
          bing_api_endpoint: searchableHttpUrlSchema.optional(),
        })
        .strict()
        .optional(),
      fetch: z
        .object({
          strategies: fetchStrategies.optional(),
          timeout_ms: positiveIntegerAtMost(300_000).optional(),
          overall_timeout_ms: positiveIntegerAtMost(600_000).optional(),
          max_response_bytes: positiveIntegerAtMost(10 * 1024 * 1024).optional(),
        })
        .strict()
        .optional(),
      grep: z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          snippet_bytes: z.number().int().min(64).max(16_384).optional(),
        })
        .strict()
        .optional(),
      ask: z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          context_bytes: z
            .number()
            .int()
            .min(256)
            .max(4 * 1024 * 1024)
            .optional(),
        })
        .strict()
        .optional(),
      ollama: z
        .object({
          endpoint: searchableHttpUrlSchema.optional(),
          model: nonblank.optional(),
          timeout_ms: positiveIntegerAtMost(600_000).optional(),
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
              max_query_bytes: positiveIntegerAtMost(16 * 1024).optional(),
              max_url_bytes: positiveIntegerAtMost(8 * 1024).optional(),
              max_title_bytes: positiveIntegerAtMost(4 * 1024).optional(),
              max_content_bytes: positiveIntegerAtMost(10 * 1024 * 1024).optional(),
              max_results: positiveIntegerAtMost(100).optional(),
              max_result_bytes: positiveIntegerAtMost(4 * 1024 * 1024).optional(),
              max_storage_bytes: positiveIntegerAtMost(256 * 1024 * 1024).optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict();
}

/** Runtime schema for resolved config and trusted direct library values. */
export const searchableConfigSchema = createSearchableConfigSchema(credentialValue);
/** Default-bearing standalone schema generated for YAML authors. */
export const searchableConfigFileSchema = createSearchableConfigSchema(credentialReference);
/** Default-free schema applied independently to every YAML and profile source layer. */
export const searchableConfigFilePatchSchema = createSearchableConfigPatchSchema(credentialReference);
/** Default-free schema applied to trusted explicit runtime override layers. */
export const searchableConfigRuntimePatchSchema = createSearchableConfigPatchSchema(credentialValue);

export type SearchableConfig = z.output<typeof searchableConfigSchema>;
export type SearchableConfigInput = z.input<typeof searchableConfigSchema>;
export type SearchableLimits = SearchableConfig['security']['limits'];

interface SearchableEnvironmentBinding {
  readonly path: string;
  readonly names: readonly string[];
  readonly kind: 'boolean' | 'integer' | 'string';
}

/** Canonical environment names precede documented legacy mcp-searchable aliases. */
export const SEARCHABLE_ENV_BINDINGS: readonly SearchableEnvironmentBinding[] = [
  { path: 'enabled', names: ['NEOTTIA_SEARCHABLE_ENABLED'], kind: 'boolean' },
  { path: 'root', names: ['NEOTTIA_SEARCHABLE_ROOT'], kind: 'string' },
  { path: 'search.provider', names: ['NEOTTIA_SEARCHABLE_PROVIDER'], kind: 'string' },
  { path: 'search.limit', names: ['NEOTTIA_SEARCHABLE_SEARCH_LIMIT'], kind: 'integer' },
  { path: 'search.timeout_ms', names: ['NEOTTIA_SEARCHABLE_SEARCH_TIMEOUT_MS'], kind: 'integer' },
  {
    path: 'search.credentials.google_api_key',
    names: ['NEOTTIA_SEARCHABLE_GOOGLE_API_KEY', 'GOOGLE_API_KEY'],
    kind: 'string',
  },
  {
    path: 'search.credentials.google_cse_id',
    names: ['NEOTTIA_SEARCHABLE_GOOGLE_CSE_ID', 'GOOGLE_CSE_ID'],
    kind: 'string',
  },
  {
    path: 'search.credentials.bing_api_key',
    names: ['NEOTTIA_SEARCHABLE_BING_API_KEY', 'BING_API_KEY'],
    kind: 'string',
  },
  {
    path: 'search.credentials.brave_api_key',
    names: ['NEOTTIA_SEARCHABLE_BRAVE_API_KEY', 'BRAVE_API_KEY'],
    kind: 'string',
  },
  {
    path: 'search.bing_api_endpoint',
    names: ['NEOTTIA_SEARCHABLE_BING_API_ENDPOINT', 'BING_API_ENDPOINT'],
    kind: 'string',
  },
  { path: 'grep.limit', names: ['NEOTTIA_SEARCHABLE_GREP_LIMIT'], kind: 'integer' },
  { path: 'ask.limit', names: ['NEOTTIA_SEARCHABLE_ASK_LIMIT'], kind: 'integer' },
  { path: 'ollama.endpoint', names: ['NEOTTIA_SEARCHABLE_OLLAMA_URL', 'OLLAMA_URL'], kind: 'string' },
  { path: 'ollama.model', names: ['NEOTTIA_SEARCHABLE_OLLAMA_MODEL', 'OLLAMA_MODEL'], kind: 'string' },
];

const SEARCHABLE_SECRET_PATHS = [
  ['search', 'credentials', 'google_api_key'],
  ['search', 'credentials', 'google_cse_id'],
  ['search', 'credentials', 'bing_api_key'],
  ['search', 'credentials', 'brave_api_key'],
] as const;

/** Complete defaults contributed at the lowest shared-resolution precedence. */
const SEARCHABLE_CONFIG_DEFAULTS: SearchableConfig = searchableConfigSchema.parse({});

/** Searchable's typed contribution to a shared multi-module configuration registry. */
export const searchableConfigContribution = defineConfigContribution({
  id: 'searchable',
  path: ['modules', 'searchable'],
  legacyPaths: [['skills', 'searchable']],
  filePatchSchema: searchableConfigFilePatchSchema,
  runtimePatchSchema: searchableConfigRuntimePatchSchema,
  resolvedSchema: searchableConfigSchema,
  defaults: SEARCHABLE_CONFIG_DEFAULTS,
  environment: [
    ...SEARCHABLE_ENV_BINDINGS.map(({ path, names, kind }) => ({
      kind,
      names: names as [string, ...string[]],
      path: path.split('.'),
    })),
    {
      kind: 'boolean' as const,
      names: ['NEOTTIA_SEARCHABLE_FETCH_FALLBACK', 'WEB_FETCH_FALLBACK'] as [string, ...string[]],
      path: ['fetch', 'strategies'],
      parse: parseFetchFallback,
    },
  ],
  secrets: SEARCHABLE_SECRET_PATHS.map((path) => ({ path })),
});

/** Options accepted by the standalone compatibility wrapper. */
export type LoadSearchableConfigOptions = Partial<SearchableConfigInput> & { env?: NodeJS.ProcessEnv };

/**
 * Resolves Searchable through @neottia/config while retaining deprecated
 * standalone file and shard aliases. Shared hosts should register
 * searchableConfigContribution once alongside their other modules.
 */
export function loadSearchableConfig(cwd: string, options: LoadSearchableConfigOptions = {}): SearchableConfig {
  const env = options.env ?? process.env;
  const contribution = compatibilityContribution(env);
  const registry = createConfigRegistry([contribution]);
  const { env: _envOption, ...searchableOverrides } = options;
  void _envOption;

  try {
    const snapshot = resolveConfig(registry, {
      compatibility: {
        ignoreUnregisteredPaths: true,
        resolveOverrideSecretReferences: true,
      },
      cwd,
      env,
      overrides: { modules: { searchable: searchableOverrides } },
      // Shared discovery handles NEOTTIA_CONFIG_FILE; retain the Searchable-only fallback here.
      projectFile:
        env[SEARCHABLE_CONFIG_FILE_ENV] === undefined && env[SEARCHABLE_MODULE_CONFIG_FILE_ENV] !== undefined
          ? resolveConfigFile(cwd, env)
          : undefined,
    });
    return snapshot.get(contribution) as SearchableConfig;
  } catch (error) {
    if (!(error instanceof ConfigResolutionError)) throw error;
    throw translateResolutionError(error);
  }
}

/** Resolves the shared or deprecated package-specific config path from the invocation CWD. */
export function resolveConfigFile(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[SEARCHABLE_CONFIG_FILE_ENV] ?? env[SEARCHABLE_MODULE_CONFIG_FILE_ENV];
  return configured ? resolve(cwd, configured) : join(cwd, DEFAULT_SEARCHABLE_CONFIG_FILE);
}

/** Validates and returns the deprecated standalone shard path. */
export function resolveShardPath(env: NodeJS.ProcessEnv = process.env): string {
  const path = env[SEARCHABLE_SHARD_PATH_ENV] ?? DEFAULT_SEARCHABLE_SHARD_PATH;
  if (!path.trim() || path.split('.').some((part) => !part)) {
    throw new SearchableError(
      'configuration',
      'CONFIG_SHARD_INVALID',
      `${SEARCHABLE_SHARD_PATH_ENV} must be a dot-path.`,
    );
  }
  return path;
}

// Compatibility adapters intentionally mirror the established domain-wrapper contract.
/* jscpd:ignore-start */
/** Builds a contribution that recognizes one deprecated arbitrary standalone shard path. */
function compatibilityContribution(env: NodeJS.ProcessEnv): typeof searchableConfigContribution {
  const shardPath = resolveShardPath(env).split('.');
  if (
    pathsEqual(shardPath, searchableConfigContribution.path) ||
    searchableConfigContribution.legacyPaths?.some((path) => pathsEqual(path, shardPath)) === true
  ) {
    return searchableConfigContribution;
  }
  return defineConfigContribution({
    ...searchableConfigContribution,
    legacyPaths: [shardPath],
  }) as typeof searchableConfigContribution;
}

/** Converts the legacy fetch-fallback toggle into the established strategy array. */
function parseFetchFallback(value: string): SearchableConfig['fetch']['strategies'] {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return ['direct', 'jina', 'wayback'];
  if (normalized === 'false' || normalized === '0') return ['direct'];
  throw new Error('invalid fetch fallback boolean');
}

/** Translates value-free shared diagnostics into Searchable's established error surface. */
function translateResolutionError(error: ConfigResolutionError): SearchableError {
  const first = error.diagnostics[0];
  const messages = error.diagnostics.map((diagnostic) => {
    const path = diagnostic.path === undefined ? '' : ` at ${diagnostic.path.join('.')}`;
    const environment = diagnostic.source?.environment === undefined ? '' : ` (${diagnostic.source.environment})`;
    const file = diagnostic.source?.file === undefined ? '' : ` in ${diagnostic.source.file}`;
    return `${diagnostic.message}${path}${environment}${file}`;
  });
  return new SearchableError(
    'configuration',
    resolutionSearchableCode(first?.code),
    `Invalid Searchable config: ${messages.join('; ')}`,
    error.diagnostics.flatMap((diagnostic) => (diagnostic.path === undefined ? [] : [diagnostic.path.join('.')])),
    {
      diagnostics: error.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        ...(diagnostic.path === undefined ? {} : { path: diagnostic.path.join('.') }),
      })),
    },
  );
}

/** Keeps historical configuration error codes where shared categories have direct equivalents. */
function resolutionSearchableCode(code: ConfigDiagnosticCode | undefined): string {
  if (code === 'IO') return 'CONFIG_READ_FAILED';
  if (code === 'YAML') return 'CONFIG_YAML_INVALID';
  if (code === 'VERSION') return 'CONFIG_VERSION_INVALID';
  if (code === 'PATH' || code === 'MERGE') return 'CONFIG_SHARD_INVALID';
  if (code === 'ENVIRONMENT') return 'CONFIG_ENV_INVALID';
  if (code === 'SECRET') return 'CREDENTIAL_REFERENCE_UNSET';
  return 'CONFIG_SCHEMA_INVALID';
}

/** Compares configuration paths without interpreting dots inside segments. */
function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
/* jscpd:ignore-end */
