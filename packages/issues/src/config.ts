import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { IssueError } from './errors.js';

// One schema-visible expression keeps runtime, generated JSON Schema, and the
// repository-store path grammar aligned for reserved roots and trailing dots.
const relativeRoot = z
  .string()
  .min(1)
  .max(1024)
  .regex(
    /^(?!\.[nN][eE][oO][tT][tT][iI][aA](?:$|\/(?:[cC][aA][cC][hH][eE]|[rR][eE][pP][oO][sS][iI][tT][oO][rR][yY]-[sS][tT][oO][rR][eE])(?:\/|$)))(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*(?:^|\/)[^/]*\.(?:\/|$))(?!.*\\)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u,
    'must be a safe non-reserved project-relative path with no trailing-period component',
  );
const positive = z.number().int().positive();

/** Complete strict skills.issues configuration shard. */
export const issueConfigSchema = z
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
    cache: z
      .object({
        max_age_ms: z.number().int().nonnegative().default(300_000),
        stale_policy: z.enum(['prompt', 'rebuild', 'fail']).default('prompt'),
      })
      .prefault({}),
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

export type IssueConfig = z.output<typeof issueConfigSchema>;
export type IssueConfigInput = z.input<typeof issueConfigSchema>;
export type LoadIssueConfigOptions = Partial<IssueConfigInput> & { env?: NodeJS.ProcessEnv };

/** Every supported env leaf, resolved after file values and before explicit overrides. */
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

/** Loads skills.issues with explicit > env > file > defaults precedence. */
export function loadIssueConfig(cwd: string, options: LoadIssueConfigOptions = {}): IssueConfig {
  const env = options.env ?? process.env;
  const file = resolve(cwd, env.NEOTTIA_CONFIG_FILE ?? env.NEOTTIA_ISSUES_CONFIG_FILE ?? '.neottia/config.yml');
  let shard: Record<string, unknown> = {};
  if (existsSync(file)) {
    const document = parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true, strict: true });
    if (document.errors.length)
      throw new IssueError(`Malformed YAML in ${file}.`, 'configuration', 'CONFIG_YAML_INVALID');
    const root = document.toJS() as unknown;
    if (!isMapping(root) || root.version !== 1)
      throw new IssueError(`Configuration requires version: 1 (${file}).`, 'configuration', 'CONFIG_VERSION');
    const path = env.NEOTTIA_CONFIG_ISSUES_PATH ?? 'skills.issues';
    if (!path.trim() || path.split('.').some((part) => !part))
      throw new IssueError('NEOTTIA_CONFIG_ISSUES_PATH must be a non-empty dot-path.', 'configuration', 'CONFIG_PATH');
    let current: unknown = root;
    for (const segment of path.split('.')) {
      if (!isMapping(current))
        throw new IssueError(`Config shard path collides at ${path}.`, 'configuration', 'CONFIG_PATH');
      current = current[segment];
      if (current === undefined) {
        current = {};
        break;
      }
    }
    if (!isMapping(current))
      throw new IssueError(`Config shard ${path} must be a mapping.`, 'configuration', 'CONFIG_SHARD');
    shard = current;
  }
  const fileParsed = issueConfigSchema.partial().safeParse(shard);
  if (!fileParsed.success) throw configSchemaError(fileParsed.error);
  const envValues: Record<string, unknown> = {};
  for (const [path, name, kind] of ISSUE_ENV_BINDINGS) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    let value: unknown = raw;
    if (kind === 'integer') {
      if (!/^\d+$/u.test(raw.trim()))
        throw new IssueError(`${name} must be an integer.`, 'configuration', 'CONFIG_ENV');
      value = Number(raw);
    } else if (kind === 'boolean') {
      if (/^(true|1)$/iu.test(raw.trim())) value = true;
      else if (/^(false|0)$/iu.test(raw.trim())) value = false;
      else throw new IssueError(`${name} must be a boolean.`, 'configuration', 'CONFIG_ENV');
    }
    assign(envValues, path, value);
  }
  const { env: _ignored, ...explicit } = options;
  void _ignored;
  const result = issueConfigSchema.safeParse(merge(fileParsed.data, envValues, explicit));
  if (!result.success) throw configSchemaError(result.error);
  return result.data;
}

/** Returns the resolved config file path for diagnostics and hosts. */
export function resolveIssueConfigFile(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(cwd, env.NEOTTIA_CONFIG_FILE ?? env.NEOTTIA_ISSUES_CONFIG_FILE ?? '.neottia/config.yml');
}

function configSchemaError(error: z.ZodError): IssueError {
  return new IssueError(
    `Invalid issues config: ${error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    'configuration',
    'CONFIG_INVALID',
  );
}
function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function merge(
  base: Record<string, unknown>,
  ...layers: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> {
  const result = structuredClone(base);
  for (const layer of layers)
    for (const [key, value] of Object.entries(layer))
      result[key] =
        isMapping(result[key]) && isMapping(value)
          ? merge(result[key] as Record<string, unknown>, value)
          : structuredClone(value);
  return result;
}
function assign(target: Record<string, unknown>, path: string, value: unknown): void {
  const pieces = path.split('.');
  let current = target;
  for (const piece of pieces.slice(0, -1)) {
    if (!isMapping(current[piece])) current[piece] = {};
    current = current[piece] as Record<string, unknown>;
  }
  current[pieces.at(-1) as string] = value;
}
