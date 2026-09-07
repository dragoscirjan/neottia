import { MEMORY_TOOLS, type MemoryToolContext } from '@neottia/memory-core';
import { Type } from 'typebox';

/**
 * pi extension: registers the nine `memory_*` tools as first-class pi tools.
 * The tools run in-process (no MCP hop) and share the exact contract of the
 * MCP server and the library tool layer.
 *
 * pi loads extensions through jiti, so this TypeScript file ships as-is.
 * Tool argument schemas use TypeBox, pi's schema language; the authoritative
 * runtime validation stays inside @neottia/memory-core (Zod).
 */

/** Minimal structural type of the pi ExtensionAPI surface we use. */
export interface PiExtensionApi {
  registerTool: (tool: {
    name: string;
    label?: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      ctx: unknown,
    ) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, never> }>;
  }) => unknown;
}

export interface MemoryExtensionOptions {
  /** Working directory of the project whose memory shard is used. */
  readonly cwd?: string;
  /** Overrides merged into the resolved memory config shard. */
  readonly configOverrides?: Record<string, unknown>;
}

const enumSchema = (values: [string, ...string[]]) => Type.Unsafe<string>({ type: 'string', enum: values });
const ulidSchema = Type.String({ description: 'Crockford ULID', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' });
const sourceSchema = Type.Object({
  kind: enumSchema(['artifact', 'user-confirmed', 'discussion', 'tool-observation']),
  ref: Type.Union([Type.String(), Type.Null()]),
  revision: Type.Union([Type.String(), Type.Null()]),
});
const storeFields = {
  memory_type: enumSchema(['semantic', 'episodic', 'procedural']),
  record_type: enumSchema(['fact', 'decision', 'event', 'lesson']),
  topic: Type.Optional(Type.String({ description: 'Topic grouping; defaults to the configured default topic' })),
  summary: Type.String({ description: 'One-line memory summary (max 240 characters)' }),
  details: Type.Optional(
    Type.Union([
      Type.String({ description: 'Optional supporting details (max 2000 characters, 12 lines)' }),
      Type.Null(),
    ]),
  ),
  source: sourceSchema,
  created_by: Type.String({ description: 'Who created this record (e.g. "agent:pi")' }),
  confidence: enumSchema(['confirmed', 'verified']),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Unique tags' })),
};

/** TypeBox parameter schemas, mirroring the core tool input contracts. */
export const memoryToolParameters = {
  memory_store: Type.Object(storeFields),
  memory_supersede: Type.Object({ target_id: ulidSchema, ...storeFields }),
  memory_delete: Type.Object({
    target_id: ulidSchema,
    reason: Type.String({ description: 'Why the record is being retired' }),
    source: sourceSchema,
    created_by: Type.String(),
  }),
  memory_get: Type.Object({ id: ulidSchema }),
  memory_list: Type.Object({
    topic: Type.Optional(Type.String()),
    memory_type: Type.Optional(enumSchema(['semantic', 'episodic', 'procedural'])),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    include_superseded: Type.Optional(Type.Boolean()),
  }),
  memory_search: Type.Object({
    query: Type.String({ description: 'Full-text query; every term must match' }),
    topic: Type.Optional(Type.String()),
    memory_type: Type.Optional(enumSchema(['semantic', 'episodic', 'procedural'])),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    max_chars: Type.Optional(Type.Integer({ minimum: 256, maximum: 100_000 })),
    include_superseded: Type.Optional(Type.Boolean()),
  }),
  memory_validate: Type.Object({}),
  memory_export: Type.Object({}),
  memory_import: Type.Object({
    content: Type.String({ description: 'JSONL payload from memory_export' }),
    preview: Type.Optional(Type.Boolean({ description: 'Validate only; do not write' })),
  }),
} as const;

export type MemoryToolName = keyof typeof memoryToolParameters;

/**
 * Registers the memory tools on a pi extension API instance.
 * Exported separately from `default` so tests can drive it with a fake API.
 */
export function registerMemoryTools(pi: PiExtensionApi, options: MemoryExtensionOptions = {}): void {
  const context: MemoryToolContext = {
    cwd: options.cwd ?? process.cwd(),
    interactive: true,
    configOverrides: options.configOverrides,
  };

  for (const tool of MEMORY_TOOLS) {
    const parameters = memoryToolParameters[tool.name as MemoryToolName] as unknown as Record<string, unknown>;
    if (!parameters) continue;
    pi.registerTool({
      name: tool.name,
      label: tool.name
        .replace(/^memory_/, '')
        .replace(/(^|_)([a-z])/gu, (_, __, character: string) => character.toUpperCase()),
      description: tool.description,
      parameters,
      async execute(_toolCallId, params) {
        const result = await tool.run(context, params);
        return {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
          details: {},
        };
      },
    });
  }
}

/** pi extension entry point. */
export default function (pi: PiExtensionApi): void {
  registerMemoryTools(pi);
}
