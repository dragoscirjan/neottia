import { z } from 'zod';
import { loadMemoryConfig } from './config.js';
import type { MemoryConfigInput } from './config.js';
import { MemoryError } from './errors.js';
import { ULID_PATTERN } from './identities.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { MemoryStore, type SearchMemoryInput, type StoreMemoryInput } from './store.js';

/**
 * Tool layer: the memory_* tool contract shared verbatim by the pi
 * extension, the OpenCode extension, and the MCP server. Tool names satisfy
 * the MCP tool-name pattern (^[a-zA-Z0-9_-]{1,128}$). Every input is
 * Zod-validated at runtime before it reaches the store, and the schemas
 * double as the published tool contract for MCP clients.
 */

export const MEMORY_TOOL_LIMITS = {
  summaryCharacters: 240,
  detailsCharacters: 2_000,
  detailsLines: 12,
  queryBytes: 16 * 1024,
  importBytes: 64 * 1024 * 1024,
} as const;

const ulid = z.string().regex(ULID_PATTERN, 'must be a Crockford ULID');
const nonempty = z.string().min(1).regex(/\S/, 'must not be blank');

function compactText(maxCharacters: number, label: string): z.ZodString {
  return z
    .string()
    .superRefine((value, context) => {
      if (countUnicodeCharacters(value, maxCharacters) > maxCharacters)
        context.addIssue({ code: 'custom', message: `${label} must be at most ${maxCharacters} Unicode characters.` });
    })
    .describe(`${label}; at most ${maxCharacters} Unicode characters.`);
}

function countUnicodeCharacters(value: string, limit: number): number {
  let count = 0;
  for (const _character of value) {
    count++;
    if (count > limit) return count;
  }
  return count;
}

function countNonEmptyLines(value: string, limit: number): number {
  let count = 0;
  let lineHasContent = false;
  let previousWasCarriageReturn = false;
  for (const character of value) {
    if (character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029') {
      if (character === '\n' && previousWasCarriageReturn) {
        previousWasCarriageReturn = false;
        continue;
      }
      if (lineHasContent) {
        count++;
        if (count > limit) return count;
      }
      lineHasContent = false;
      previousWasCarriageReturn = character === '\r';
      continue;
    }
    previousWasCarriageReturn = false;
    if (!/^\s$/u.test(character)) lineHasContent = true;
  }
  if (lineHasContent) count++;
  return count;
}

const summaryInput = compactText(MEMORY_TOOL_LIMITS.summaryCharacters, 'Summary').min(1);
const detailsInput = compactText(MEMORY_TOOL_LIMITS.detailsCharacters, 'Details')
  .superRefine((value, context) => {
    const lines = countNonEmptyLines(value, MEMORY_TOOL_LIMITS.detailsLines);
    if (lines > MEMORY_TOOL_LIMITS.detailsLines)
      context.addIssue({
        code: 'custom',
        message: `Details must have at most ${MEMORY_TOOL_LIMITS.detailsLines} non-empty lines.`,
      });
  })
  .describe(
    `Details; at most ${MEMORY_TOOL_LIMITS.detailsCharacters} Unicode characters and ${MEMORY_TOOL_LIMITS.detailsLines} non-empty lines.`,
  );

function byteBoundedText(maxBytes: number, label: string): z.ZodString {
  return z
    .string()
    .refine((value) => Buffer.byteLength(value, 'utf8') <= maxBytes, `${label} exceeds ${maxBytes} UTF-8 bytes.`)
    .describe(`${label}; at most ${maxBytes} UTF-8 bytes.`);
}

const sourceSchema = z
  .object({
    kind: z.enum(['artifact', 'user-confirmed', 'discussion', 'tool-observation']),
    ref: z.string().nullable(),
    revision: z.string().nullable(),
  })
  .strict();

const storeInputSchema = z
  .object({
    memory_type: z.enum(['semantic', 'episodic', 'procedural']),
    record_type: z.enum(['fact', 'decision', 'event', 'lesson']),
    topic: nonempty.optional(),
    summary: summaryInput,
    details: detailsInput.nullable().optional(),
    source: sourceSchema,
    created_by: nonempty,
    confidence: z.enum(['confirmed', 'verified']),
    tags: z
      .array(nonempty)
      .superRefine((values, context) => {
        if (new Set(values).size !== values.length)
          context.addIssue({ code: 'custom', message: 'Tags must be unique.' });
      })
      .optional(),
  })
  .strict();

const supersedeInputSchema = storeInputSchema.extend({ target_id: ulid }).strict();
const deleteInputSchema = z
  .object({ target_id: ulid, reason: z.string().min(1).max(1000), source: sourceSchema, created_by: nonempty })
  .strict();
const getInputSchema = z.object({ id: ulid }).strict();
const listInputSchema = z
  .object({
    topic: nonempty.optional(),
    memory_type: z.enum(['semantic', 'episodic', 'procedural']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    include_superseded: z.boolean().optional(),
  })
  .strict();
const searchInputSchema = listInputSchema
  .extend({
    query: byteBoundedText(MEMORY_TOOL_LIMITS.queryBytes, 'Query').min(1),
    max_chars: z.number().int().min(256).max(100_000).optional(),
  })
  .strict();
const validateInputSchema = z.object({}).strict();
const exportInputSchema = z.object({}).strict();
const importInputSchema = z
  .object({
    content: byteBoundedText(MEMORY_TOOL_LIMITS.importBytes, 'Import content'),
    preview: z.boolean().optional(),
  })
  .strict();

export interface MemoryToolContext {
  readonly cwd: string;
  /** Whether the host harness can prompt the user (extensions: yes, MCP: no). */
  readonly interactive: boolean;
  /** Optional config overrides resolved by the host before calling core. */
  readonly configOverrides?: Partial<MemoryConfigInput>;
  /** Interactive host callback for stale cache rebuild confirmation. */
  readonly onStaleCache?: () => boolean | Promise<boolean>;
  /** Internal stable identity used when a host supplies call-local callbacks. */
  readonly storeKey?: object;
}

export interface MemoryToolDefinition<S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> {
  readonly name: string;
  readonly description: string;
  /** Runtime input contract; validated before the handler runs. */
  readonly inputSchema: S;
  readonly run: (context: MemoryToolContext, input: z.output<S>) => Promise<unknown>;
}

const contextStores = new WeakMap<object, MemoryStore>();
const staleCacheCallbacks = new AsyncLocalStorage<MemoryToolContext['onStaleCache']>();

function storeFor(context: MemoryToolContext): MemoryStore {
  const key = context.storeKey ?? context;
  const existing = contextStores.get(key);
  if (existing) return existing;
  // Reuse one store per host context so remote backends do not create a new
  // PostgreSQL pool for every tool invocation. The callback is resolved from
  // async-local state so overlapping host calls keep their own UI context.
  const store = MemoryStore.fromConfig(loadMemoryConfig(context.cwd, context.configOverrides), context.cwd, {
    onStaleCache: () => {
      const callback = staleCacheCallbacks.getStore() ?? context.onStaleCache;
      return callback ? callback() : true;
    },
  });
  contextStores.set(key, store);
  return store;
}

/** Closes and forgets the backend associated with one host context. */
export async function closeMemoryToolContext(context: MemoryToolContext): Promise<void> {
  const key = context.storeKey ?? context;
  const store = contextStores.get(key);
  if (!store) return;
  contextStores.delete(key);
  await store.close();
}

function makeTool<S extends z.ZodObject<z.ZodRawShape>>(
  name: string,
  description: string,
  inputSchema: S,
  handler: (context: MemoryToolContext, input: z.output<S>) => Promise<unknown>,
): MemoryToolDefinition<S> {
  return {
    name,
    description,
    inputSchema,
    run: async (context, input) => {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success)
        throw new MemoryError(
          `Invalid ${name} input:\n${parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`).join('\n')}`,
        );
      return staleCacheCallbacks.run(context.onStaleCache, () => handler(context, parsed.data));
    },
  };
}

export const MEMORY_TOOLS: readonly MemoryToolDefinition<z.ZodObject<z.ZodRawShape>>[] = [
  makeTool(
    'memory_store',
    'Store a new memory record (fact/decision/event/lesson) in the project memory shard.',
    storeInputSchema,
    async (context, input) => storeFor(context).store(input as unknown as StoreMemoryInput),
  ),
  makeTool(
    'memory_supersede',
    'Replace an active memory record with a new one; the target stays referenced via supersedes.',
    supersedeInputSchema,
    async (context, input) => {
      const { target_id, ...rest } = input as unknown as { target_id: string } & StoreMemoryInput;
      return storeFor(context).supersede(target_id, rest);
    },
  ),
  makeTool(
    'memory_delete',
    'Tombstone an active memory record with a reason; canonical files are never deleted.',
    deleteInputSchema,
    async (context, input) => storeFor(context).delete(input.target_id, input.reason, input.source, input.created_by),
  ),
  makeTool('memory_get', 'Fetch a memory record or tombstone by its ULID.', getInputSchema, async (context, input) =>
    storeFor(context).get(input.id),
  ),
  makeTool(
    'memory_list',
    'List active memory records, newest first, optionally filtered by topic and memory_type.',
    listInputSchema,
    async (context, input) => storeFor(context).list(input),
  ),
  makeTool(
    'memory_search',
    'Backend-ranked full-text search over the memory shard (SQLite FTS5, pg_textsearch, or PostgreSQL tsvector).',
    searchInputSchema,
    async (context, input) => storeFor(context).search(input as SearchMemoryInput),
  ),
  makeTool(
    'memory_validate',
    'Validate canonical memory records and verify or rebuild the SQLite cache.',
    validateInputSchema,
    async (context) => storeFor(context).validate(),
  ),
  makeTool('memory_export', 'Export all memory records and tombstones as JSONL.', exportInputSchema, async (context) =>
    storeFor(context).export(),
  ),
  makeTool(
    'memory_import',
    'Import memory records/tombstones from JSONL; pass preview=true to validate without writing.',
    importInputSchema,
    async (context, input) => storeFor(context).import(input.content, input.preview ?? false),
  ),
];

export function findMemoryTool(name: string): MemoryToolDefinition | undefined {
  return MEMORY_TOOLS.find((tool) => tool.name === name);
}

export {
  storeInputSchema,
  supersedeInputSchema,
  deleteInputSchema,
  getInputSchema,
  listInputSchema,
  searchInputSchema,
  validateInputSchema,
  exportInputSchema,
  importInputSchema,
};
