import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { loadMemoryConfig } from './config.js';
import type { MemoryConfig, MemoryConfigInput } from './config.js';
import { MemoryError } from './errors.js';
import { MemoryStore, type MemoryStoreOptions, type SearchMemoryInput, type StoreMemoryInput } from './store.js';
import {
  deleteInputSchema,
  exportInputSchema,
  getInputSchema,
  importInputSchema,
  listInputSchema,
  memoryToolSchemas,
  searchInputSchema,
  storeInputSchema,
  supersedeInputSchema,
  validateInputSchema,
  type MemoryToolName,
} from './tool-contracts.js';

/**
 * Tool layer shared verbatim by the Pi extension, OpenCode extension, and MCP
 * server. Inputs and outputs are validated against the canonical contract
 * before crossing a harness boundary.
 */

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
  /** Injectable store constructor for deterministic host lifecycle tests. */
  readonly storeFactory?: (config: MemoryConfig, cwd: string, options?: Partial<MemoryStoreOptions>) => MemoryStore;
}

export interface MemoryToolDefinition {
  readonly name: MemoryToolName;
  readonly description: string;
  /** Runtime input contract; validated before the handler runs. */
  readonly inputSchema: z.ZodObject;
  /** Runtime output contract; validated before the result reaches a host. */
  readonly outputSchema: z.ZodType;
  readonly run: (context: MemoryToolContext, input: unknown) => Promise<unknown>;
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
  const createStore = context.storeFactory ?? MemoryStore.fromConfig;
  const store = createStore(loadMemoryConfig(context.cwd, context.configOverrides), context.cwd, {
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

function makeTool<I extends z.ZodObject, O extends z.ZodType>(
  name: MemoryToolName,
  description: string,
  inputSchema: I,
  outputSchema: O,
  handler: (context: MemoryToolContext, input: z.output<I>) => Promise<z.input<O>>,
): MemoryToolDefinition {
  return {
    name,
    description,
    inputSchema,
    outputSchema,
    run: async (context, input) => {
      const parsedInput = inputSchema.safeParse(input);
      if (!parsedInput.success) throw contractError(name, 'input', parsedInput.error);
      const result = await staleCacheCallbacks.run(context.onStaleCache, () => handler(context, parsedInput.data));
      const parsedOutput = outputSchema.safeParse(result);
      if (!parsedOutput.success) throw contractError(name, 'output', parsedOutput.error);
      return parsedOutput.data;
    },
  };
}

function contractError(name: MemoryToolName, boundary: 'input' | 'output', error: z.ZodError): MemoryError {
  return new MemoryError(
    `Invalid ${name} ${boundary}:\n${error.issues
      .map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n')}`,
  );
}

export const MEMORY_TOOLS: readonly MemoryToolDefinition[] = [
  makeTool(
    'memory_store',
    'Store a new memory record (fact/decision/event/lesson) in the project memory shard.',
    storeInputSchema,
    memoryToolSchemas.memory_store.output,
    async (context, input) => storeFor(context).store(input as StoreMemoryInput),
  ),
  makeTool(
    'memory_supersede',
    'Replace an active memory record with a new one; the target stays referenced via supersedes.',
    supersedeInputSchema,
    memoryToolSchemas.memory_supersede.output,
    async (context, input) => {
      const { target_id, ...rest } = input;
      return storeFor(context).supersede(target_id, rest as StoreMemoryInput);
    },
  ),
  makeTool(
    'memory_delete',
    'Tombstone an active memory record with a reason; canonical files are never deleted.',
    deleteInputSchema,
    memoryToolSchemas.memory_delete.output,
    async (context, input) => storeFor(context).delete(input.target_id, input.reason, input.source, input.created_by),
  ),
  makeTool(
    'memory_get',
    'Fetch a memory record or tombstone by its ULID.',
    getInputSchema,
    memoryToolSchemas.memory_get.output,
    async (context, input) => storeFor(context).get(input.id),
  ),
  makeTool(
    'memory_list',
    'List active memory records, newest first, optionally filtered by topic and memory_type.',
    listInputSchema,
    memoryToolSchemas.memory_list.output,
    async (context, input) => storeFor(context).list(input),
  ),
  makeTool(
    'memory_search',
    'Backend-ranked full-text search over the memory shard (SQLite FTS5, pg_textsearch, or PostgreSQL tsvector).',
    searchInputSchema,
    memoryToolSchemas.memory_search.output,
    async (context, input) => storeFor(context).search(input as SearchMemoryInput),
  ),
  makeTool(
    'memory_validate',
    'Validate canonical memory records and verify or rebuild the SQLite cache.',
    validateInputSchema,
    memoryToolSchemas.memory_validate.output,
    async (context) => storeFor(context).validate(),
  ),
  makeTool(
    'memory_export',
    'Export all memory records and tombstones as JSONL.',
    exportInputSchema,
    memoryToolSchemas.memory_export.output,
    async (context) => storeFor(context).export(),
  ),
  makeTool(
    'memory_import',
    'Import memory records/tombstones from JSONL; pass preview=true to validate without writing.',
    importInputSchema,
    memoryToolSchemas.memory_import.output,
    async (context, input) => storeFor(context).import(input.content, input.preview ?? false),
  ),
];

export function findMemoryTool(name: string): MemoryToolDefinition | undefined {
  return MEMORY_TOOLS.find((tool) => tool.name === name);
}

export {
  deleteInputSchema,
  exportInputSchema,
  getInputSchema,
  importInputSchema,
  listInputSchema,
  searchInputSchema,
  storeInputSchema,
  supersedeInputSchema,
  validateInputSchema,
};
