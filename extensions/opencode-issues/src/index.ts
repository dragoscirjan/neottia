import { resolveHostConfigSnapshot } from '@neottia/config-registry';
import {
  closeIssueToolContext,
  issueConfigContribution,
  ISSUE_TOOLS,
  type DesignDocumentReferenceResolver,
  type IssueToolContext,
} from '@neottia/issues';
import { createIssuesDesignDocsComposition } from '@neottia/issues-design-docs';
import { buildOpencodeTools } from '@neottia/opencode-adapter';
import { tool, type Plugin } from '@opencode-ai/plugin';

export type OpenCodeToolFactory = typeof tool;

/** Builds OpenCode definitions directly from the canonical core registry. */
export function buildIssueTools(
  context: IssueToolContext,
  factory: OpenCodeToolFactory,
): Record<string, ReturnType<OpenCodeToolFactory>> {
  return buildOpencodeTools(ISSUE_TOOLS, context, factory);
}

export interface OpenCodeIssuesOptions {
  readonly resolver?: DesignDocumentReferenceResolver;
  readonly env?: NodeJS.ProcessEnv;
}

/** Builds a composable plugin while keeping the default package entry thin. */
export function createIssuesPlugin(options: OpenCodeIssuesOptions = {}): Plugin {
  return async (host) => {
    const effective = resolveHostConfigSnapshot({
      cwd: host.directory,
      env: options.env ?? process.env,
      interactive: false,
    });
    const context: IssueToolContext = {
      cwd: host.directory,
      interactive: false,
      config: effective.get(issueConfigContribution),
      resolver:
        options.resolver ?? createIssuesDesignDocsComposition({ cwd: host.directory, snapshot: effective }).resolver,
      storeKey: {},
    };
    return { tool: buildIssueTools(context, tool), dispose: () => closeIssueToolContext(context) };
  };
}

/** OpenCode uses the active worktree directory and never hops through MCP. */
export const NeottiaIssuesPlugin: Plugin = createIssuesPlugin();
export default NeottiaIssuesPlugin;
