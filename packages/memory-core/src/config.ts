import { join, resolve } from 'node:path';
import { ConfigResolutionError, createConfigRegistry, defineConfigContribution, resolveConfig } from '@neottia/config';
import { z } from 'zod';
import { ConfigError } from './errors.js';

/** Env var holding the project config location, checked before the module-specific alias. */
export const CONFIG_FILE_ENV = 'NEOTTIA_CONFIG_FILE';
/** Deprecated Memory-only project config location. */
export const MEMORY_CONFIG_FILE_ENV = 'NEOTTIA_MEMORY_CONFIG_FILE';
/** Deprecated env var overriding the path of the Memory shard. */
export const MEMORY_SHARD_PATH_ENV = 'NEOTTIA_CONFIG_MEMORY_PATH';
/** Deprecated shard path retained by the standalone compatibility wrapper. */
export const DEFAULT_SHARD_PATH = 'skills.memory';
/** Default project config location, relative to the working directory. */
export const DEFAULT_CONFIG_FILE = '.neottia/config.yml';

const CREDENTIAL_REFERENCE_PATTERN = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u;
// Every path form uses one separator and nonempty, non-dot components.
const MEMORY_PATH_COMPONENT = String.raw`(?!\.{1,2}(?:[\\/]|$))[^\\/\0\r\n\u2028\u2029]+`;
const MEMORY_ROOT_PATTERN = new RegExp(
  String.raw`^(?:${MEMORY_PATH_COMPONENT}(?:/${MEMORY_PATH_COMPONENT})*|${MEMORY_PATH_COMPONENT}(?:\\${MEMORY_PATH_COMPONENT})*|/${MEMORY_PATH_COMPONENT}(?:/${MEMORY_PATH_COMPONENT})*|[A-Za-z]:/${MEMORY_PATH_COMPONENT}(?:/${MEMORY_PATH_COMPONENT})*|[A-Za-z]:\\${MEMORY_PATH_COMPONENT}(?:\\${MEMORY_PATH_COMPONENT})*)$`,
  'u',
);
const nonemptyString = z.string().min(1).regex(/\S/, 'must not be blank');
const memoryRootPath = z
  .string()
  .min(1)
  .max(1024)
  // Keep the complete safety rule representable in the generated JSON Schema.
  .regex(MEMORY_ROOT_PATTERN, 'must be a safe relative path or an absolute path');
const credentialValue = z.string().min(1, 'must not be empty');
const credentialReference = z.string().regex(CREDENTIAL_REFERENCE_PATTERN, 'must be an exact ${ENV_VAR} reference');

/** Runtime schema for resolved config and explicit library values. */
export const memoryConfigSchema = createResolvedMemoryConfigSchema(credentialValue);
/** File-facing schema: credentials in YAML must never contain literals. */
export const memoryConfigFileSchema = createResolvedMemoryConfigSchema(credentialReference);
/** Default-free schema applied independently to every YAML source layer. */
export const memoryConfigFilePatchSchema = createMemoryConfigPatchSchema(credentialReference);
/** Default-free schema applied to trusted runtime override layers. */
export const memoryConfigRuntimePatchSchema = createMemoryConfigPatchSchema(credentialValue);

/** Builds a complete schema whose defaults preserve the standalone Memory API. */
function createResolvedMemoryConfigSchema(credentialSchema: z.ZodString) {
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

/** Builds a deep optional patch without injecting defaults into a source layer. */
function createMemoryConfigPatchSchema(credentialSchema: z.ZodString) {
  return z
    .object({
      enabled: z.boolean().optional(),
      root: memoryRootPath.optional(),
      backend: z.enum(['filesystem', 'postgres']).optional(),
      namespace: z
        .object({
          organization_id: nonemptyString.optional(),
          project_id: nonemptyString.optional(),
          default_topic: nonemptyString.optional(),
          scope: nonemptyString.optional(),
        })
        .strict()
        .optional(),
      provider: z
        .object({
          db: z
            .object({
              pg: z
                .object({
                  host: nonemptyString.optional(),
                  port: z.number().int().min(1).max(65_535).optional(),
                  database: nonemptyString.optional(),
                  ssl: z.boolean().optional(),
                  user: credentialSchema.optional(),
                  password: credentialSchema.optional(),
                })
                .strict()
                .optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
      retrieval: z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          max_chars: z.number().int().min(256).max(100_000).optional(),
          include_superseded: z.boolean().optional(),
        })
        .strict()
        .optional(),
      cache: z
        .object({
          max_age_ms: z.number().int().min(0).optional(),
          stale_policy: z.enum(['prompt', 'rebuild', 'fail']).optional(),
        })
        .strict()
        .optional(),
      security: z
        .object({
          secret_patterns: z.array(z.string().min(1)).optional(),
          entropy_heuristic: z.boolean().optional(),
          limits: z
            .object({
              max_file_bytes: z.number().int().positive().optional(),
              max_files: z.number().int().positive().optional(),
              max_total_bytes: z.number().int().positive().optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict();
}

export type MemoryConfig = z.infer<typeof memoryConfigSchema>;
export type MemoryConfigInput = z.input<typeof memoryConfigSchema>;

/** Existing Memory environment bindings remain public for compatibility and documentation. */
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

/** Shared coercion kinds are declarative contribution metadata, not loader logic. */
const MEMORY_ENVIRONMENT_KINDS: Readonly<Record<string, 'boolean' | 'integer' | 'string'>> = {
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

/** Credential leaves use default env vars when absent from higher-precedence sources. */
export const CREDENTIAL_DEFAULTS: Readonly<Record<string, string>> = {
  'provider.db.pg.user': 'NEOTTIA_MEMORY_DB_PG_USER',
  'provider.db.pg.password': 'NEOTTIA_MEMORY_DB_PG_PASSWORD',
};

/** Complete defaults contributed at the lowest shared-resolution precedence. */
const MEMORY_CONFIG_DEFAULTS: MemoryConfig = memoryConfigSchema.parse({});

/** Memory's typed contribution to a shared multi-module configuration registry. */
export const memoryConfigContribution = defineConfigContribution({
  id: 'memory',
  path: ['modules', 'memory'],
  legacyPaths: [['skills', 'memory']],
  filePatchSchema: memoryConfigFilePatchSchema,
  runtimePatchSchema: memoryConfigRuntimePatchSchema,
  resolvedSchema: memoryConfigSchema,
  defaults: MEMORY_CONFIG_DEFAULTS,
  environment: MEMORY_ENV_BINDINGS.map(({ env, path }) => ({
    kind: MEMORY_ENVIRONMENT_KINDS[path] ?? 'string',
    names: [env],
    path: path.split('.'),
  })),
  secrets: [
    { path: ['provider', 'db', 'pg', 'user'], fallbackEnvironment: ['NEOTTIA_MEMORY_DB_PG_USER'] },
    { path: ['provider', 'db', 'pg', 'password'], fallbackEnvironment: ['NEOTTIA_MEMORY_DB_PG_PASSWORD'] },
  ],
});

/** Resolves the project config file path used by the standalone compatibility wrapper. */
export function resolveConfigFile(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[CONFIG_FILE_ENV] ?? env[MEMORY_CONFIG_FILE_ENV];
  return fromEnv ? resolve(cwd, fromEnv) : join(cwd, DEFAULT_CONFIG_FILE);
}

/** Resolves the deprecated standalone shard path override. */
export function resolveShardPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[MEMORY_SHARD_PATH_ENV];
  if (fromEnv !== undefined && (!fromEnv.trim() || fromEnv.split('.').some((part) => !part))) {
    throw new ConfigError(`${MEMORY_SHARD_PATH_ENV} must be a non-empty dot-path.`);
  }
  return fromEnv ?? DEFAULT_SHARD_PATH;
}

/** Options accepted by loadMemoryConfig; explicit arguments outrank every shared source. */
export type LoadMemoryConfigOptions = Partial<MemoryConfigInput> & { env?: NodeJS.ProcessEnv };

/**
 * Resolves Memory through @neottia/config while retaining deprecated standalone
 * file and shard aliases. New multi-module hosts should register and resolve
 * memoryConfigContribution directly.
 */
export function loadMemoryConfig(cwd: string, options: LoadMemoryConfigOptions = {}): MemoryConfig {
  const env = options.env ?? process.env;
  const contribution = compatibilityContribution(env);
  const registry = createConfigRegistry([contribution]);
  const { env: _envOption, ...memoryOverrides } = options;
  void _envOption;

  try {
    const snapshot = resolveConfig(registry, {
      compatibility: {
        ignoreUnregisteredPaths: true,
        resolveOverrideSecretReferences: true,
      },
      cwd,
      env,
      overrides: { modules: { memory: memoryOverrides } },
      // The shared file variable is discovered by the resolver; this preserves the Memory-only fallback.
      projectFile:
        env[CONFIG_FILE_ENV] === undefined && env[MEMORY_CONFIG_FILE_ENV] !== undefined
          ? resolveConfigFile(cwd, env)
          : undefined,
    });
    return snapshot.get(contribution) as MemoryConfig;
  } catch (error) {
    if (!(error instanceof ConfigResolutionError)) throw error;
    throw translateResolutionError(error);
  }
}

/** Builds a contribution that recognizes one deprecated arbitrary standalone shard path. */
function compatibilityContribution(env: NodeJS.ProcessEnv): typeof memoryConfigContribution {
  const shardPath = resolveShardPath(env).split('.');
  if (
    pathsEqual(shardPath, memoryConfigContribution.path) ||
    memoryConfigContribution.legacyPaths?.some((path) => pathsEqual(path, shardPath)) === true
  ) {
    return memoryConfigContribution;
  }
  return defineConfigContribution({
    ...memoryConfigContribution,
    legacyPaths: [shardPath],
  }) as typeof memoryConfigContribution;
}

/** Translates safe shared diagnostics into Memory's established ConfigError surface. */
function translateResolutionError(error: ConfigResolutionError): ConfigError {
  const details = error.diagnostics.map((diagnostic) => {
    const category =
      diagnostic.code === 'YAML' && !diagnostic.message.includes('must be a mapping')
        ? 'Malformed YAML'
        : diagnostic.message;
    const path = diagnostic.path === undefined ? '' : ` at ${diagnostic.path.join('.')}`;
    const environment = diagnostic.source?.environment === undefined ? '' : ` (${diagnostic.source.environment})`;
    const file = diagnostic.source?.file === undefined ? '' : ` in ${diagnostic.source.file}`;
    return `${category}${path}${environment}${file}`;
  });
  const validationPaths = error.diagnostics
    .flatMap((diagnostic) => (diagnostic.path === undefined ? [] : [diagnostic.path.join('.')]))
    .filter((path, index, paths) => paths.indexOf(path) === index);
  return new ConfigError(`Invalid memory config shard:\n${details.join('\n')}`, validationPaths);
}

/** Compares configuration paths without interpreting dots inside segments. */
function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
