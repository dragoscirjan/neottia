import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ResolvedConfigSnapshot } from '@neottia/config';
import { resolveHostConfigSnapshot } from '@neottia/config-registry';
import {
  createSearchableRuntime,
  findSearchableTool,
  searchableToolJsonSchema,
  SEARCHABLE_TOOLS,
  SearchableError,
  searchableConfigContribution,
  serializeSearchableError,
  type SearchableConfigInput,
  type SearchableRuntime,
  type SearchableRuntimeFactory,
} from '@neottia/searchable-core';

/** Construction options for the generic Searchable MCP server. */
export interface CreateSearchableServerOptions {
  readonly cwd?: string;
  readonly name?: string;
  readonly version?: string;
  readonly snapshot?: ResolvedConfigSnapshot;
  readonly env?: NodeJS.ProcessEnv;
  readonly configOverrides?: Partial<SearchableConfigInput>;
  readonly runtimeFactory?: SearchableRuntimeFactory;
}

/** Creates a tools-only server backed by one owned runtime. */
export function createSearchableServer(options: CreateSearchableServerOptions = {}): Server {
  const cwd = options.cwd ?? process.cwd();
  const snapshot = resolveHostConfigSnapshot({
    interactive: false,
    cwd,
    ...(options.snapshot ? { snapshot: options.snapshot } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.configOverrides ? { overrides: { modules: { searchable: options.configOverrides } } } : {}),
  });
  const config = snapshot.get(searchableConfigContribution);
  const runtime: SearchableRuntime = (options.runtimeFactory ?? createSearchableRuntime)({ cwd, config });
  const server = new Server(
    { name: options.name ?? '@neottia/searchable-mcp', version: options.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  );
  const baseClose = server.close.bind(server);
  let closePromise: Promise<void> | undefined;
  server.close = () => {
    closePromise ??= Promise.allSettled([runtime.close(), baseClose()]).then((results) => {
      const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
      if (errors.length) throw new AggregateError(errors, 'Searchable MCP shutdown failed.');
    });
    return closePromise;
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: SEARCHABLE_TOOLS.map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: searchableToolJsonSchema(definition.name, 'input') as {
        type: 'object';
        properties?: Record<string, object>;
        required?: string[];
      },
      outputSchema: searchableToolJsonSchema(definition.name, 'output') as {
        type: 'object';
        properties?: Record<string, object>;
        required?: string[];
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const definition = findSearchableTool(request.params.name);
    if (!definition)
      return toolError(new SearchableError('validation', 'TOOL_NOT_FOUND', `Unknown tool: ${request.params.name}`));
    try {
      const result = await definition.run(
        { cwd, services: runtime, signal: extra.signal, config },
        request.params.arguments ?? {},
      );
      const structured = result as Record<string, unknown>;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    } catch (error: unknown) {
      return toolError(
        error instanceof SearchableError
          ? error
          : new SearchableError('service', 'SERVICE_FAILED', 'Searchable service failed.'),
      );
    }
  });
  return server;
}

function toolError(error: SearchableError) {
  const body = serializeSearchableError(error);
  return { content: [{ type: 'text' as const, text: JSON.stringify(body) }], isError: true as const };
}
