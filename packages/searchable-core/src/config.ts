import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { SearchableError } from './errors.js';
import { searchableHttpUrlSchema } from './schemas.js';

/** Shared config-file override used by every Neottia skill. */
export const SEARCHABLE_CONFIG_FILE_ENV = 'NEOTTIA_CONFIG_FILE';
/** Searchable-specific config-file override used when the shared override is absent. */
export const SEARCHABLE_MODULE_CONFIG_FILE_ENV = 'NEOTTIA_SEARCHABLE_CONFIG_FILE';
/** Environment override for the Searchable shard dot-path. */
export const SEARCHABLE_SHARD_PATH_ENV = 'NEOTTIA_CONFIG_SEARCHABLE_PATH';
/** Default versioned YAML shard owned by this package. */
export const DEFAULT_SEARCHABLE_SHARD_PATH = 'skills.searchable';
/** Default repository-local configuration file. */
export const DEFAULT_SEARCHABLE_CONFIG_FILE = '.neottia/config.yml';

const CREDENTIAL_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u;
const SAFE_RELATIVE_PATH = /^(?!\.{1,2}(?:\/|$))(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!\/)(?![A-Za-z]:)[^\\\0\r\n]+$/u;
const nonblank = z.string().trim().min(1).regex(/\S/u, 'must not be blank');
const credentialValue = z.string().min(1);
const credentialReference = z.string().regex(CREDENTIAL_REFERENCE, 'must be an exact ${ENV_VAR} reference');

/** Creates parallel file and runtime schemas without permitting literal YAML credentials. */
function createSearchableConfigSchema(credential: z.ZodString) {
  return z
    .object({
      enabled: z.boolean().default(false),
      root: z.string().min(1).max(1024).regex(SAFE_RELATIVE_PATH).default('.neottia/searchable'),
      search: z
        .object({
          provider: z.enum(['duckduckgo', 'google', 'bing', 'brave']).default('duckduckgo'),
          limit: z.number().int().min(1).max(100).default(5),
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
          strategies: z
            .array(z.enum(['direct', 'jina', 'wayback']))
            .min(1)
            .max(3)
            .refine((values) => new Set(values).size === values.length, 'strategies must be unique')
            .default(['direct', 'jina', 'wayback'])
            .meta({ uniqueItems: true }),
          timeout_ms: z.number().int().positive().max(300_000).default(10_000),
          overall_timeout_ms: z.number().int().positive().max(600_000).default(20_000),
          max_response_bytes: z
            .number()
            .int()
            .positive()
            .max(10 * 1024 * 1024)
            .default(10 * 1024 * 1024),
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
          timeout_ms: z.number().int().positive().max(600_000).default(60_000),
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
              max_query_bytes: z
                .number()
                .int()
                .positive()
                .max(16 * 1024)
                .default(16 * 1024),
              max_url_bytes: z
                .number()
                .int()
                .positive()
                .max(8 * 1024)
                .default(8 * 1024),
              max_title_bytes: z
                .number()
                .int()
                .positive()
                .max(4 * 1024)
                .default(4 * 1024),
              max_content_bytes: z
                .number()
                .int()
                .positive()
                .max(10 * 1024 * 1024)
                .default(10 * 1024 * 1024),
              max_results: z.number().int().positive().max(100).default(100),
              max_result_bytes: z
                .number()
                .int()
                .positive()
                .max(4 * 1024 * 1024)
                .default(4 * 1024 * 1024),
              max_storage_bytes: z
                .number()
                .int()
                .positive()
                .max(256 * 1024 * 1024)
                .default(256 * 1024 * 1024),
            })
            .strict()
            .prefault({}),
        })
        .strict()
        .prefault({}),
    })
    .strict();
}

/** Runtime schema for resolved config and trusted library overrides. */
export const searchableConfigSchema = createSearchableConfigSchema(credentialValue);
/** File schema generated for YAML authors; credential literals are rejected. */
export const searchableConfigFileSchema = createSearchableConfigSchema(credentialReference);

export type SearchableConfig = z.infer<typeof searchableConfigSchema>;
export type SearchableConfigInput = z.input<typeof searchableConfigSchema>;
export type SearchableLimits = SearchableConfig['security']['limits'];

interface EnvBinding {
  readonly path: string;
  readonly names: readonly string[];
  readonly kind: 'boolean' | 'integer' | 'string';
}

/** Canonical environment names precede useful legacy mcp-searchable aliases. */
export const SEARCHABLE_ENV_BINDINGS: readonly EnvBinding[] = [
  { path: 'enabled', names: ['NEOTTIA_SEARCHABLE_ENABLED'], kind: 'boolean' },
  { path: 'root', names: ['NEOTTIA_SEARCHABLE_ROOT'], kind: 'string' },
  { path: 'search.provider', names: ['NEOTTIA_SEARCHABLE_PROVIDER'], kind: 'string' },
  { path: 'search.limit', names: ['NEOTTIA_SEARCHABLE_SEARCH_LIMIT'], kind: 'integer' },
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

/** Loader options implement explicit override > environment > file > defaults. */
export type LoadSearchableConfigOptions = Partial<SearchableConfigInput> & { env?: NodeJS.ProcessEnv };

/** Loads and validates one versioned `skills.searchable` config shard. */
export function loadSearchableConfig(cwd: string, options: LoadSearchableConfigOptions = {}): SearchableConfig {
  const env = options.env ?? process.env;
  const file = resolveConfigFile(cwd, env);
  const configuredFile = env[SEARCHABLE_CONFIG_FILE_ENV] ?? env[SEARCHABLE_MODULE_CONFIG_FILE_ENV];
  const fileExists = existsSync(file);
  if (configuredFile && !fileExists)
    throw new SearchableError(
      'configuration',
      'CONFIG_READ_FAILED',
      `Unable to read explicitly selected Searchable config: ${file}`,
    );
  const shard = fileExists ? readShard(file, resolveShardPath(env)) : {};
  const fileResult = searchableConfigFileSchema.partial().safeParse(shard);
  if (!fileResult.success) throw configSchemaError('Invalid Searchable config file shard', fileResult.error);

  const { env: _env, ...explicit } = options;
  void _env;
  const result = searchableConfigSchema.safeParse(deepMerge(fileResult.data, envOverlay(env), explicit));
  if (!result.success) throw configSchemaError('Invalid resolved Searchable config', result.error);
  expandCredentialReferences(result.data, env, file);
  return result.data;
}

/** Resolves the shared or package-specific config path against the invocation CWD. */
export function resolveConfigFile(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[SEARCHABLE_CONFIG_FILE_ENV] ?? env[SEARCHABLE_MODULE_CONFIG_FILE_ENV];
  return configured ? resolve(cwd, configured) : join(cwd, DEFAULT_SEARCHABLE_CONFIG_FILE);
}

/** Validates and returns the configurable shard path. */
export function resolveShardPath(env: NodeJS.ProcessEnv = process.env): string {
  const path = env[SEARCHABLE_SHARD_PATH_ENV] ?? DEFAULT_SEARCHABLE_SHARD_PATH;
  if (!path.trim() || path.split('.').some((part) => !part))
    throw new SearchableError(
      'configuration',
      'CONFIG_SHARD_INVALID',
      `${SEARCHABLE_SHARD_PATH_ENV} must be a dot-path.`,
    );
  return path;
}

/** Parses the versioned YAML root and finds the configured mapping shard. */
function readShard(file: string, path: string): Record<string, unknown> {
  let document;
  try {
    document = parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true, strict: true });
  } catch (error: unknown) {
    throw new SearchableError(
      'configuration',
      'CONFIG_READ_FAILED',
      `Unable to read Searchable config: ${describe(error)}`,
    );
  }
  if (document.errors.length || document.warnings.length)
    throw new SearchableError(
      'configuration',
      'CONFIG_YAML_INVALID',
      `Malformed Searchable configuration YAML: ${file}`,
    );
  const root: unknown = document.toJS();
  if (!isRecord(root) || root['version'] !== 1)
    throw new SearchableError(
      'configuration',
      'CONFIG_VERSION_INVALID',
      `Configuration requires version: 1 (${file}).`,
    );
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (!isRecord(current))
      throw new SearchableError('configuration', 'CONFIG_SHARD_INVALID', `Config shard path collides: ${path}.`);
    current = current[segment];
    if (current === undefined) return {};
  }
  if (!isRecord(current))
    throw new SearchableError('configuration', 'CONFIG_SHARD_INVALID', `Config shard must be a mapping: ${path}.`);
  return current;
}

/** Builds a shard-shaped overlay, selecting canonical aliases before legacy ones. */
function envOverlay(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const overlay: Record<string, unknown> = {};
  for (const binding of SEARCHABLE_ENV_BINDINGS) {
    const name = binding.names.find((candidate) => env[candidate] !== undefined && env[candidate] !== '');
    if (name) assign(overlay, binding.path, coerce(name, env[name] as string, binding.kind));
  }
  const fallback = env['NEOTTIA_SEARCHABLE_FETCH_FALLBACK'] ?? env['WEB_FETCH_FALLBACK'];
  if (fallback !== undefined && fallback !== '') {
    const enabled = coerce('NEOTTIA_SEARCHABLE_FETCH_FALLBACK', fallback, 'boolean');
    assign(overlay, 'fetch.strategies', enabled ? ['direct', 'jina', 'wayback'] : ['direct']);
  }
  return overlay;
}

/** Resolves file credential references after higher-precedence layers are merged. */
function expandCredentialReferences(config: SearchableConfig, env: NodeJS.ProcessEnv, file: string): void {
  const credentials = config.search.credentials;
  for (const key of ['google_api_key', 'google_cse_id', 'bing_api_key', 'brave_api_key'] as const) {
    const reference = credentials[key];
    if (!reference || !CREDENTIAL_REFERENCE.test(reference)) continue;
    const variable = reference.slice(2, -1);
    const value = env[variable];
    if (!value)
      throw new SearchableError(
        'configuration',
        'CREDENTIAL_REFERENCE_UNSET',
        `Credential reference at skills.searchable.search.credentials.${key} points to unset env var (${file}).`,
        [`skills.searchable.search.credentials.${key}`],
      );
    credentials[key] = value;
  }
}

/** Coerces environment text without relying on permissive JavaScript casts. */
function coerce(name: string, value: string, kind: EnvBinding['kind']): unknown {
  if (kind === 'boolean') {
    if (/^(?:true|1)$/iu.test(value)) return true;
    if (/^(?:false|0)$/iu.test(value)) return false;
    throw new SearchableError('configuration', 'CONFIG_ENV_INVALID', `${name} must be a boolean.`);
  }
  if (kind === 'integer') {
    if (!/^-?\d+$/u.test(value.trim()))
      throw new SearchableError('configuration', 'CONFIG_ENV_INVALID', `${name} must be an integer.`);
    return Number(value);
  }
  return value;
}

/** Formats schema issues without echoing rejected values. */
function configSchemaError(prefix: string, error: z.ZodError): SearchableError {
  const paths = error.issues.map((issue) => `skills.searchable.${issue.path.join('.')}`);
  const message = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  return new SearchableError('configuration', 'CONFIG_SCHEMA_INVALID', `${prefix}: ${message}`, paths);
}

/** Assigns a dotted leaf into a nested environment overlay. */
function assign(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current[part])) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1) as string] = value;
}

/** Deep-merges mapping layers while replacing scalar and array leaves. */
function deepMerge(
  base: Record<string, unknown>,
  ...layers: readonly Record<string, unknown>[]
): Record<string, unknown> {
  const result = structuredClone(base);
  for (const layer of layers)
    for (const [key, value] of Object.entries(layer))
      result[key] = isRecord(result[key]) && isRecord(value) ? deepMerge(result[key], value) : structuredClone(value);
  return result;
}

/** Narrows plain YAML mappings. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Provides a bounded description for config I/O failures. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
