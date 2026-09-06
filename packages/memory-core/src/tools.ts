import { loadMemoryConfig } from './config.js';
import type { MemoryConfig } from './config.js';
import type { MemorySource } from './schemas.js';
import { MemoryStore, type SearchMemoryInput, type StoreMemoryInput } from './store.js';

/**
 * Tool layer: the memory_* tool contract shared verbatim by the pi
 * extension, the OpenCode extension, and the MCP server. Tool names satisfy
 * the MCP tool-name pattern (^[a-zA-Z0-9_-]{1,128}$).
 */

export interface MemoryToolContext {
  readonly cwd: string;
  /** Whether the host harness can prompt the user (extensions: yes, MCP: no). */
  readonly interactive: boolean;
  /** Optional config overrides resolved by the host before calling core. */
  readonly configOverrides?: Partial<MemoryConfig>;
}

export interface MemoryToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly run: (context: MemoryToolContext, input: Record<string, unknown>) => Promise<unknown>;
}

function storeFor(context: MemoryToolContext): MemoryStore {
  // The store enforces skills.memory.enabled itself so validate()/import
  // preview can surface disabled state as reports instead of throws.
  return MemoryStore.fromConfig(loadMemoryConfig(context.cwd, context.configOverrides), context.cwd);
}

export const MEMORY_TOOLS: readonly MemoryToolDefinition[] = [
  {
    name: 'memory_store',
    description: 'Store a new memory record (fact/decision/event/lesson) in the project memory shard.',
    run: async (context, input) => storeFor(context).store(asStoreInput(input)),
  },
  {
    name: 'memory_supersede',
    description: 'Replace an active memory record with a new one; the target stays referenced via supersedes.',
    run: async (context, input) => {
      const { target_id, ...rest } = splitTargetId(input);
      return storeFor(context).supersede(target_id, asStoreInput(rest));
    },
  },
  {
    name: 'memory_delete',
    description: 'Tombstone an active memory record with a reason; canonical files are never deleted.',
    run: async (context, input) => {
      const args = input as unknown as { target_id: string; reason: string; source: MemorySource; created_by: string };
      return storeFor(context).delete(args.target_id, args.reason, args.source, args.created_by);
    },
  },
  {
    name: 'memory_get',
    description: 'Fetch a memory record or tombstone by its ULID.',
    run: async (context, input) => storeFor(context).get(readString(input, 'id')),
  },
  {
    name: 'memory_list',
    description: 'List active memory records, newest first, optionally filtered by topic and memory_type.',
    run: async (context, input) => storeFor(context).list(input as SearchMemoryInput),
  },
  {
    name: 'memory_search',
    description: 'BM25-ranked full-text search over the memory shard (SQLite FTS5).',
    run: async (context, input) => storeFor(context).search(input as SearchMemoryInput),
  },
  {
    name: 'memory_validate',
    description: 'Validate canonical memory records and verify or rebuild the SQLite cache.',
    run: async (context) => storeFor(context).validate(),
  },
  {
    name: 'memory_export',
    description: 'Export all memory records and tombstones as JSONL.',
    run: async (context) => storeFor(context).export(),
  },
  {
    name: 'memory_import',
    description: 'Import memory records/tombstones from JSONL; pass preview=true to validate without writing.',
    run: async (context, input) => {
      const args = input as unknown as { content: string; preview?: boolean };
      return storeFor(context).import(args.content, args.preview ?? false);
    },
  },
];

export function findMemoryTool(name: string): MemoryToolDefinition | undefined {
  return MEMORY_TOOLS.find((tool) => tool.name === name);
}

function splitTargetId(input: Record<string, unknown>): Record<string, unknown> & { target_id: string } {
  return input as Record<string, unknown> & { target_id: string };
}

function asStoreInput(input: Record<string, unknown>): StoreMemoryInput {
  return input as unknown as StoreMemoryInput;
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value : '';
}
