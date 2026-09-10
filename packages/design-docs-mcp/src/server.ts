import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  closeDesignDocsToolContext,
  DESIGN_DOCS_TOOLS,
  designDocsToolJsonSchema,
  findDesignDocsTool,
  loadDesignDocsConfig,
  serializeDesignDocsError,
  type DesignDocsToolContext,
  type DesignDocsToolName,
} from '@neottia/design-docs';

export interface CreateDesignDocsServerOptions {
  readonly cwd?: string;
  readonly name?: string;
  readonly version?: string;
}
export function effectiveDesignDocsStalePolicy(cwd: string, env: NodeJS.ProcessEnv = process.env): 'rebuild' | 'fail' {
  const policy = loadDesignDocsConfig(cwd, { env }).cache.stale_policy;
  return policy === 'fail' ? 'fail' : 'rebuild';
}

/** Creates a non-interactive MCP server from the shared registry. */
export function createDesignDocsServer(options: CreateDesignDocsServerOptions = {}): Server {
  const cwd = options.cwd ?? process.cwd();
  const server = new Server(
    { name: options.name ?? '@neottia/design-docs-mcp', version: options.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  );
  const context: DesignDocsToolContext = {
    cwd,
    interactive: false,
    configOverrides: { cache: { stale_policy: effectiveDesignDocsStalePolicy(cwd) } },
  };
  const originalClose = server.close.bind(server);
  server.close = async () => {
    await closeDesignDocsToolContext(context);
    await originalClose();
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: DESIGN_DOCS_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: designDocsToolJsonSchema(tool.name, 'input') as {
        type: 'object';
        properties?: Record<string, object>;
        required?: string[];
      },
      ...(objectOutputSchema(tool.name) ? { outputSchema: objectOutputSchema(tool.name) } : {}),
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = findDesignDocsTool(request.params.name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
    try {
      const result = await tool.run({ ...context, signal: extra.signal }, request.params.arguments ?? {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        ...(isRecord(result) ? { structuredContent: result } : {}),
      };
    } catch (error: unknown) {
      const structured = serializeDesignDocsError(error);
      return {
        content: [{ type: 'text', text: JSON.stringify(structured) }],
        structuredContent: structured,
        isError: true,
      };
    }
  });
  return server;
}
function objectOutputSchema(
  name: DesignDocsToolName,
): { type: 'object'; properties?: Record<string, object>; required?: string[] } | undefined {
  const schema = designDocsToolJsonSchema(name, 'output');
  return schema['type'] === 'object'
    ? (schema as { type: 'object'; properties?: Record<string, object>; required?: string[] })
    : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
