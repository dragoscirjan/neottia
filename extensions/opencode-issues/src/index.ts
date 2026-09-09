import {
  closeIssueToolContext,
  ISSUE_TOOLS,
  type DesignDocumentReferenceResolver,
  type IssueToolContext,
} from '@neottia/issues';
import { tool, type Plugin } from '@opencode-ai/plugin';

export type OpenCodeToolFactory = typeof tool;

/** Builds OpenCode definitions directly from the canonical core registry. */
export function buildIssueTools(
  context: IssueToolContext,
  factory: OpenCodeToolFactory,
): Record<string, ReturnType<OpenCodeToolFactory>> {
  return Object.fromEntries(
    ISSUE_TOOLS.map((definition) => [
      definition.name,
      factory({
        description: definition.description,
        args: definition.inputSchema.shape,
        async execute(args: Record<string, unknown>, invocation) {
          const signal =
            'abort' in invocation && invocation.abort instanceof AbortSignal ? invocation.abort : undefined;
          const result = await definition.run({ ...context, ...(signal ? { signal } : {}) }, args);
          return JSON.stringify(result, null, 2);
        },
      }),
    ]),
  );
}

export interface OpenCodeIssuesOptions {
  readonly resolver?: DesignDocumentReferenceResolver;
}

/** Builds a composable plugin while keeping the default package entry thin. */
export function createIssuesPlugin(options: OpenCodeIssuesOptions = {}): Plugin {
  return async (host) => {
    const context: IssueToolContext = {
      cwd: host.directory,
      interactive: false,
      resolver: options.resolver,
      storeKey: {},
    };
    return { tool: buildIssueTools(context, tool), dispose: () => closeIssueToolContext(context) };
  };
}

/** OpenCode uses the active worktree directory and never hops through MCP. */
export const NeottiaIssuesPlugin: Plugin = createIssuesPlugin();
export default NeottiaIssuesPlugin;
