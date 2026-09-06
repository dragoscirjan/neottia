import { z } from 'zod';
import { loadMemoryConfig } from './config.js';
import type { MemoryConfig } from './config.js';
import { MemoryError } from './errors.js';
import { ULID_PATTERN } from './identities.js';
import { MemoryStore, type SearchMemoryInput, type StoreMemoryInput } from './store.js';

/**
 * Tool layer: the memory_* tool contract shared verbatim by the pi
 * extension, the OpenCode extension, and the MCP server. Tool names satisfy
 * the MCP tool-name pattern (^[a-zA-Z0-9_-]{1,128}$). Every input is
 * Zod-validated at runtime before it reaches the store, and the schemas
 * double as the published tool contract for MCP clients.
 */

const ulid = z.string().regex(ULID_PATTERN, 'must be a Crockford ULID');
const nonempty = z.string().min(1).regex(/\S/, 'must not be blank');

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
    summary: z.string().min(1).max(1000),
    details: z.string().max(12_000).nullable().optional(),
    source: sourceSchema,
    created_by: nonempty,
    confidence: z.enum(['confirmed', 'verified']),
    tags: z.array(nonempty).optional(),
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
    query: z
      .string()
      .min(1)
      .max(16 * 1024),
    max_chars: z.number().int().min(256).max(100_000).optional(),
  })
  .strict();
const validateInputSchema = z.object({}).strict();
const exportInputSchema = z.object({}).strict();
const importInputSchema = z
  .object({ content: z.string().max(64 * 1024 * 1024), preview: z.boolean().optional() })
  .strict();

export interface MemoryToolContext {
  readonly cwd: string;
  /** Whether the host harness can prompt the user (extensions: yes, MCP: no). */
  readonly interactive: boolean;
  /** Optional config overrides resolved by the host before calling core. */
  readonly configOverrides?: Partial<MemoryConfig>;
}

export interface MemoryToolDefinition<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  /** Runtime input contract; validated before the handler runs. */
  readonly inputSchema: S;
  readonly run: (context: MemoryToolContext, input: z.output<S>) => Promise<unknown>;
}

function storeFor(context: MemoryToolContext): MemoryStore {
  // The store enforces skills.memory.enabled itself so validate()/import
  // preview can surface disabled state as reports instead of throws.
  return MemoryStore.fromConfig(loadMemoryConfig(context.cwd, context.configOverrides), context.cwd);
}

function makeTool<S extends z.ZodType>(
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
      return handler(context, parsed.data);
    },
  };
}

export const MEMORY_TOOLS: readonly MemoryToolDefinition<z.ZodType>[] = [
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
    'BM25-ranked full-text search over the memory shard (SQLite FTS5).',
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
