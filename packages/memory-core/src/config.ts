import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { ConfigError, formatSchemaError } from './errors.js';

/**
 * Memory config shard, following the Sharded Module Configuration design:
 * the config object keeps the harnessctl shape and this module owns the
 * `skills.memory` section. Every leaf resolves through
 * `explicit override > env var > file shard > default`, and every leaf is
 * Zod-validated through this single schema.
 *
 * Structural variables:
 *   config file: NEOTTIA_CONFIG_FILE ?? NEOTTIA_MEMORY_CONFIG_FILE ?? <cwd>/.neottia/config.yml
 *   shard path:  NEOTTIA_CONFIG_MEMORY_PATH ?? 'skills.memory'
 */

/** Env var holding the config file location, checked before the module-specific one. */
export const CONFIG_FILE_ENV = 'NEOTTIA_CONFIG_FILE';
/** Module-specific config file override, checked after NEOTTIA_CONFIG_FILE. */
export const MEMORY_CONFIG_FILE_ENV = 'NEOTTIA_MEMORY_CONFIG_FILE';
/** Env var overriding the dot-path of the memory shard inside the config object. */
export const MEMORY_SHARD_PATH_ENV = 'NEOTTIA_CONFIG_MEMORY_PATH';
/** Default dot-path of the memory shard inside the config object. */
export const DEFAULT_SHARD_PATH = 'skills.memory';
/** Default config file location, relative to the working directory. */
export const DEFAULT_CONFIG_FILE = '.neottia/config.yml';

const CREDENTIAL_REFERENCE_PATTERN = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u;
const MEMORY_ROOT_PATTERN =
  /^(?:\/[^\0]*|[A-Za-z]:[\\/][^\0]*|(?!\.{1,2}(?:[\\/]|$))(?!.*(?:^|[\\/])\.{1,2}(?:[\\/]|$))[^\\/\0]+(?:[\\/][^\\/\0]+)*)$/u;
const nonemptyString = z.string().min(1).regex(/\S/, 'must not be blank');

/**
 * Memory root accepts a safe relative path (resolved against the working
 * directory) or an absolute path (shared or workspace-independent roots,
 * commonly provided through NEOTTIA_MEMORY_ROOT).
 */
const memoryRootPath = z
  .string()
  .min(1)
  .max(1024)
  // Keep the safety rule representable in the generated JSON Schema.
  .regex(MEMORY_ROOT_PATTERN, 'must be a safe relative path or an absolute path')
  .refine((value) => isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value) || value !== '.');

const credentialValue = z.string().min(1, 'must not be empty');
const credentialReference = z.string().regex(CREDENTIAL_REFERENCE_PATTERN, 'must be an exact ${ENV_VAR} reference');

/** Runtime schema for resolved config and explicit library overrides. */
export const memoryConfigSchema = createMemoryConfigSchema(credentialValue);

/** File-facing schema: credentials in YAML must never contain literals. */
export const memoryConfigFileSchema = createMemoryConfigSchema(credentialReference);

/** Builds matching runtime and file schemas with source-specific credentials. */
function createMemoryConfigSchema(credentialSchema: z.ZodString) {
  return z
    .object({
      enabled: z.boolean().default(false),
      root: memoryRootPath.default('.neottia/memory'),
      backend: z.enum(['filesystem', 'postgres']).default('filesystem'),
      namespace: z
        .object({
          organization_id: nonemptyString.default('local'),
          project_id: nonemptyString.default('project'),
          default_topic: nonemptyString.default('general'),
          scope: nonemptyString.default('global'),
        })
        .prefault({}),
      provider: z
        .object({
          db: z
            .object({
              pg: z
                .object({
                  host: nonemptyString.default('localhost'),
                  port: z.number().int().min(1).max(65_535).default(5432),
                  database: nonemptyString.default('neottia'),
                  ssl: z.boolean().default(true),
                  // YAML uses the strict reference schema; resolved code config may contain literals.
                  user: credentialSchema.optional(),
                  password: credentialSchema.optional(),
                })
                .prefault({}),
            })
            .prefault({}),
        })
        .prefault({}),
      retrieval: z
        .object({
          limit: z.number().int().min(1).max(100).default(8),
          max_chars: z.number().int().min(256).max(100_000).default(12_000),
          include_superseded: z.boolean().default(false),
        })
        .prefault({}),
      cache: z
        .object({
          max_age_ms: z.number().int().min(0).default(300_000),
          stale_policy: z.enum(['prompt', 'rebuild', 'fail']).default('prompt'),
        })
        .prefault({}),
      security: z
        .object({
          secret_patterns: z.array(z.string().min(1)).default([]),
          entropy_heuristic: z.boolean().default(true),
          limits: z
            .object({
              max_file_bytes: z
                .number()
                .int()
                .positive()
                .default(16 * 1024 * 1024),
              max_files: z.number().int().positive().default(10_000),
              max_total_bytes: z
                .number()
                .int()
                .positive()
                .default(256 * 1024 * 1024),
            })
            .prefault({}),
        })
        .prefault({}),
    })
    .strict();
}

export type MemoryConfig = z.infer<typeof memoryConfigSchema>;
export type MemoryConfigInput = z.input<typeof memoryConfigSchema>;

/**
 * Env bindings for leaves worth overriding without a config file, plus the
 * credential defaults. Order matters only for documentation; every binding
 * is independent and coerced through the shard schema.
 */
export const MEMORY_ENV_BINDINGS: ReadonlyArray<{ path: string; env: string }> = [
  { path: 'enabled', env: 'NEOTTIA_MEMORY_ENABLED' },
  { path: 'root', env: 'NEOTTIA_MEMORY_ROOT' },
  { path: 'backend', env: 'NEOTTIA_MEMORY_BACKEND' },
  { path: 'namespace.organization_id', env: 'NEOTTIA_MEMORY_NAMESPACE_ORGANIZATION_ID' },
  { path: 'namespace.project_id', env: 'NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID' },
  { path: 'namespace.default_topic', env: 'NEOTTIA_MEMORY_NAMESPACE_DEFAULT_TOPIC' },
  { path: 'namespace.scope', env: 'NEOTTIA_MEMORY_NAMESPACE_SCOPE' },
  { path: 'provider.db.pg.host', env: 'NEOTTIA_MEMORY_DB_PG_HOST' },
  { path: 'provider.db.pg.port', env: 'NEOTTIA_MEMORY_DB_PG_PORT' },
  { path: 'provider.db.pg.database', env: 'NEOTTIA_MEMORY_DB_PG_DATABASE' },
  { path: 'provider.db.pg.ssl', env: 'NEOTTIA_MEMORY_DB_PG_SSL' },
  { path: 'retrieval.limit', env: 'NEOTTIA_MEMORY_RETRIEVAL_LIMIT' },
  { path: 'retrieval.max_chars', env: 'NEOTTIA_MEMORY_RETRIEVAL_MAX_CHARS' },
  { path: 'retrieval.include_superseded', env: 'NEOTTIA_MEMORY_RETRIEVAL_INCLUDE_SUPERSEDED' },
  { path: 'cache.max_age_ms', env: 'NEOTTIA_MEMORY_CACHE_MAX_AGE_MS' },
  { path: 'cache.stale_policy', env: 'NEOTTIA_MEMORY_CACHE_STALE_POLICY' },
  { path: 'security.entropy_heuristic', env: 'NEOTTIA_MEMORY_SECURITY_ENTROPY_HEURISTIC' },
];

/** Credential leaves use default env vars when absent from the config file. */
export const CREDENTIAL_DEFAULTS: Readonly<Record<string, string>> = {
  'provider.db.pg.user': 'NEOTTIA_MEMORY_DB_PG_USER',
  'provider.db.pg.password': 'NEOTTIA_MEMORY_DB_PG_PASSWORD',
};

/** Resolves the config file path for the memory module. */
export function resolveConfigFile(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[CONFIG_FILE_ENV] ?? env[MEMORY_CONFIG_FILE_ENV];
  return fromEnv ? resolve(cwd, fromEnv) : join(cwd, DEFAULT_CONFIG_FILE);
}

/** Resolves the dot-path of the memory shard inside the config object. */
export function resolveShardPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[MEMORY_SHARD_PATH_ENV];
  if (fromEnv !== undefined && (!fromEnv.trim() || fromEnv.split('.').some((part) => !part)))
    throw new ConfigError(`${MEMORY_SHARD_PATH_ENV} must be a non-empty dot-path.`);
  return fromEnv ?? DEFAULT_SHARD_PATH;
}

/** Options accepted by loadMemoryConfig; explicit arguments outrank everything. */
export type LoadMemoryConfigOptions = Partial<MemoryConfigInput> & { env?: NodeJS.ProcessEnv };

/**
 * Loads and validates the memory config shard.
 * Missing file or missing shard always yields defaults plus env bindings,
 * which keeps the module usable standalone.
 */
export function loadMemoryConfig(cwd: string, options: LoadMemoryConfigOptions = {}): MemoryConfig {
  const env = options.env ?? process.env;
  const configFile = resolveConfigFile(cwd, env);
  let shard: unknown = {};

  if (existsSync(configFile)) {
    const root = readConfigRoot(configFile);
    shard = navigateShard(root, resolveShardPath(env), configFile);
  }

  const fileResult = memoryConfigFileSchema.partial().safeParse(shard);
  if (!fileResult.success)
    throw new ConfigError(
      `Invalid memory config shard:\n${formatSchemaError(fileResult.error)}`,
      fileResult.error.issues.map((issue) => ['skills.memory', ...issue.path].join('.')),
    );

  const { env: _envOption, ...overrides } = options;
  void _envOption;
  const merged = deepMerge(fileResult.data, envOverlay(env), overrides as Record<string, unknown>);

  const result = memoryConfigSchema.safeParse(merged);
  if (!result.success)
    throw new ConfigError(
      `Invalid memory config shard:\n${formatSchemaError(result.error)}`,
      result.error.issues.map((issue) => ['skills.memory', ...issue.path].join('.')),
    );

  expandCredentials(result.data, env, configFile);
  return result.data;
}

/** Reads the config file and applies the minimal root schema (version, mapping). */
function readConfigRoot(configFile: string): Record<string, unknown> {
  let content: string;
  try {
    content = readFileSync(configFile, 'utf8');
  } catch (error: unknown) {
    throw new ConfigError(`Unable to read ${configFile}: ${describe(error)}`);
  }

  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length > 0) {
    const position = document.errors[0]?.linePos?.[0];
    const location = position ? ` at line ${position.line}, column ${position.col}` : '';
    throw new ConfigError(`Malformed YAML in ${configFile}: ${document.errors[0]?.code ?? 'PARSE_ERROR'}${location}`);
  }
  const root = document.toJS();
  if (root === null || typeof root !== 'object' || Array.isArray(root))
    throw new ConfigError(`Configuration root must be a YAML mapping: ${configFile}`);
  if ((root as Record<string, unknown>).version !== 1)
    throw new ConfigError(
      `Config requires an explicit 'version: 1' (${configFile}); see the Sharded Module Configuration wiki page.`,
      ['version'],
    );
  return root as Record<string, unknown>;
}

/** Navigates the shard dot-path; a missing section yields an empty shard. */
function navigateShard(root: Record<string, unknown>, shardPath: string, configFile: string): unknown {
  let current: unknown = root;
  for (const segment of shardPath.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current))
      throw new ConfigError(`Config shard path collides with a non-mapping value: ${shardPath}`, [shardPath]);
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) return {};
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current))
    throw new ConfigError(`Config shard must be a mapping: ${shardPath} (${configFile})`, [shardPath]);
  return current;
}

/** Collects NEOTTIA_MEMORY_* environment values into a shard-shaped overlay. */
function envOverlay(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const overlay: Record<string, unknown> = {};
  for (const { path, env: name } of MEMORY_ENV_BINDINGS) {
    const value = env[name];
    if (value === undefined || value === '') continue;
    assignPath(overlay, path, coerceEnvValue(name, path, value));
  }
  return overlay;
}

/** Expected schema kind per env binding, used for deterministic coercion. */
const ENV_KINDS: Readonly<Record<string, 'boolean' | 'integer' | 'string'>> = {
  enabled: 'boolean',
  root: 'string',
  backend: 'string',
  'namespace.organization_id': 'string',
  'namespace.project_id': 'string',
  'namespace.default_topic': 'string',
  'namespace.scope': 'string',
  'provider.db.pg.host': 'string',
  'provider.db.pg.port': 'integer',
  'provider.db.pg.database': 'string',
  'provider.db.pg.ssl': 'boolean',
  'retrieval.limit': 'integer',
  'retrieval.max_chars': 'integer',
  'retrieval.include_superseded': 'boolean',
  'cache.max_age_ms': 'integer',
  'cache.stale_policy': 'string',
  'security.entropy_heuristic': 'boolean',
};

/** Coerces an env value to the schema kind of its binding; invalid forms are config errors. */
function coerceEnvValue(name: string, path: string, value: string): unknown {
  const kind = ENV_KINDS[path] ?? 'string';
  const trimmed = value.trim();
  if (kind === 'boolean') {
    const normalized = trimmed.toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    throw new ConfigError(`Env var ${name} must be a boolean (true/false/1/0).`);
  }
  if (kind === 'integer') {
    if (!/^-?\d+$/u.test(trimmed)) throw new ConfigError(`Env var ${name} must be an integer.`);
    return Number(trimmed);
  }
  return value;
}

/**
 * Expands ${VAR} credential references from the environment exactly once.
 * Absent credentials fall back to their default env vars; explicit library
 * overrides may be literal values and pass through unchanged.
 */
function expandCredentials(config: MemoryConfig, env: NodeJS.ProcessEnv, configFile: string): void {
  const pg = config.provider.db.pg;
  for (const [path, defaultEnv] of Object.entries(CREDENTIAL_DEFAULTS)) {
    const key = path.split('.').at(-1) as 'user' | 'password';
    const reference = pg[key];
    if (reference === undefined) {
      const fallback = env[defaultEnv];
      if (fallback !== undefined && fallback !== '') pg[key] = fallback;
      continue;
    }
    if (!CREDENTIAL_REFERENCE_PATTERN.test(reference)) continue;
    const varName = reference.slice(2, -1);
    const value = env[varName];
    if (value === undefined || value === '')
      throw new ConfigError(
        `Credential reference '${reference}' at skills.memory.${path} points to unset env var '${varName}' (${configFile}).`,
        [`skills.memory.${path}`],
      );
    pg[key] = value;
  }
}

function assignPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    if (typeof current[segment] !== 'object' || current[segment] === null) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1) as string] = value;
}

function deepMerge(
  base: Record<string, unknown>,
  ...layers: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(base);
  for (const layer of layers)
    for (const [key, value] of Object.entries(layer)) {
      const current = result[key];
      result[key] = isMapping(current) && isMapping(value) ? deepMerge(current, value) : structuredClone(value);
    }
  return result;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
