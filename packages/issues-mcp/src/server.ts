import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  closeIssueToolContext,
  findIssueTool,
  issueToolJsonSchema,
  ISSUE_TOOLS,
  asIssueError,
  type IssueToolContext,
  type DesignDocumentReferenceResolver,
} from '@neottia/issues';
import { createIssuesDesignDocsComposition } from '@neottia/issues-design-docs';

export interface CreateIssueServerOptions {
  readonly cwd?: string;
  readonly name?: string;
  readonly version?: string;
  /** Optional composition seam for stable design-document links. */
  readonly resolver?: DesignDocumentReferenceResolver;
}

/** Creates a harness-neutral, non-interactive MCP server. */
export function createIssueServer(options: CreateIssueServerOptions = {}): Server {
  const cwd = options.cwd ?? process.cwd();
  const context: IssueToolContext = {
    cwd,
    interactive: false,
    resolver: options.resolver ?? createIssuesDesignDocsComposition({ cwd }).resolver,
    storeKey: {},
  };
  const server = new Server(
    { name: options.name ?? '@neottia/issues-mcp', version: options.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  );
  const baseClose = server.close.bind(server);
  server.close = async () => {
    await closeIssueToolContext(context);
    await baseClose();
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ISSUE_TOOLS.map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: issueToolJsonSchema(definition.name, 'input') as {
        type: 'object';
        properties?: Record<string, object>;
        required?: string[];
      },
      outputSchema: issueToolJsonSchema(definition.name, 'output') as {
        type: 'object';
        properties?: Record<string, object>;
        required?: string[];
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const definition = findIssueTool(request.params.name);
    if (!definition)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              category: 'validation',
              code: 'TOOL_NOT_FOUND',
              message: `Unknown tool: ${request.params.name}`,
              retryable: false,
            }),
          },
        ],
        isError: true,
      };
    try {
      const result = await definition.run({ ...context, signal: extra.signal }, request.params.arguments ?? {});
      const structured = result as Record<string, unknown>;
      return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    } catch (error: unknown) {
      // Every adapter serializes the same bounded issue-domain error contract.
      const body = asIssueError(error).toJSON();
      return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
    }
  });
  return server;
}
