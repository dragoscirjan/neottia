import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  closeMemoryToolContext,
  findMemoryTool,
  loadMemoryConfig,
  memoryToolJsonSchema,
  MEMORY_TOOLS,
  type MemoryToolContext,
  type MemoryToolName,
} from '@neottia/memory-core';

/**
 * MCP stdio server for the Neottia memory tools. Tool names, descriptions,
 * and input contracts come verbatim from @neottia/memory-core, so every
 * harness speaking MCP gets the exact same surface as the in-process
 * extensions.
 *
 * Uses the low-level Server with zod v4's native toJSONSchema: the published
 * tools/list contract is generated from the same Zod schemas the store
 * validates with, so contract drift is impossible.
 */

export interface CreateMemoryServerOptions {
  readonly cwd?: string;
  /** Interactive hosts may prompt; the MCP surface never does. */
  readonly interactive?: boolean;
  readonly name?: string;
  readonly version?: string;
}

/** Non-interactive hosts get a silent rebuild instead of a prompt policy. */
export function effectiveStalePolicy(cwd: string, env: NodeJS.ProcessEnv = process.env): 'rebuild' | 'fail' | 'prompt' {
  const config = loadMemoryConfig(cwd, { env });
  return config.cache.stale_policy === 'prompt' ? 'rebuild' : config.cache.stale_policy;
}

export function createMemoryServer(options: CreateMemoryServerOptions = {}): Server {
  const cwd = options.cwd ?? process.cwd();
  const interactive = options.interactive ?? false;
  const server = new Server(
    { name: options.name ?? '@neottia/memory-mcp', version: options.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Downgrade 'prompt' to 'rebuild' only when the user did not choose a
  // policy explicitly; 'fail' is respected everywhere.
  const configOverrides: { cache?: { stale_policy: 'rebuild' } } = {};
  if (effectiveStalePolicy(cwd) === 'rebuild') configOverrides.cache = { stale_policy: 'rebuild' };
  const context: MemoryToolContext = { cwd, interactive, configOverrides };
  const closeServer = server.close.bind(server);
  server.close = async () => {
    let cleanupError: unknown;
    try {
      await closeMemoryToolContext(context);
    } catch (error: unknown) {
      cleanupError = error;
    }
    try {
      await closeServer();
    } catch (error: unknown) {
      if (cleanupError !== undefined) throw new AggregateError([cleanupError, error], 'MCP server shutdown failed.');
      throw error;
    }
    if (cleanupError !== undefined) throw cleanupError;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MEMORY_TOOLS.map((tool) => {
      const outputSchema = objectOutputSchema(tool.name);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: memoryToolJsonSchema(tool.name, 'input') as {
          type: 'object';
          properties?: Record<string, object>;
          required?: string[];
        },
        ...(outputSchema ? { outputSchema } : {}),
      };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = findMemoryTool(request.params.name);
    if (!tool)
      return {
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    try {
      const result = await tool.run(context, (request.params.arguments ?? {}) as Record<string, unknown>);
      const outputSchema = objectOutputSchema(tool.name);
      return {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
        ...(outputSchema && isRecord(result) ? { structuredContent: result } : {}),
      };
    } catch (error: unknown) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  return server;
}

/** MCP currently permits only object-rooted structured output schemas. */
function objectOutputSchema(
  name: MemoryToolName,
): { type: 'object'; properties?: Record<string, object>; required?: string[] } | undefined {
  const schema = memoryToolJsonSchema(name, 'output');
  if (schema['type'] === 'object')
    return schema as { type: 'object'; properties?: Record<string, object>; required?: string[] };
  const alternatives = schema['anyOf'];
  if (
    Array.isArray(alternatives) &&
    alternatives.every(
      (alternative) =>
        alternative !== null &&
        typeof alternative === 'object' &&
        (alternative as Record<string, unknown>)['type'] === 'object',
    )
  )
    return { ...schema, type: 'object' } as {
      type: 'object';
      properties?: Record<string, object>;
      required?: string[];
    };
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
