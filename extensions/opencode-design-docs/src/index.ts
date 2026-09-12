import { resolve } from 'node:path';
import {
  closeDesignDocsToolContext,
  DESIGN_DOCS_TOOLS,
  designDocsConfigContribution,
  serializeDesignDocsError,
  type DesignDocsToolContext,
  type DesignDocLinkValidator,
} from '@neottia/design-docs';
import { createIssuesDesignDocsComposition, resolveHostConfigSnapshot } from '@neottia/issues-design-docs';
import { tool, type Plugin } from '@opencode-ai/plugin';

export type OpenCodeToolFactory = typeof tool;

/** Builds in-process OpenCode tools directly from shared Zod shapes. */
export function buildDesignDocsTools(
  context: DesignDocsToolContext,
  toolFactory: OpenCodeToolFactory,
  contextForCwd?: (cwd: string) => DesignDocsToolContext,
): Record<string, ReturnType<OpenCodeToolFactory>> {
  return Object.fromEntries(
    DESIGN_DOCS_TOOLS.map((definition) => {
      const registered = toolFactory({
        description: definition.description,
        args: definition.inputSchema.shape,
        async execute(args: Record<string, unknown>, rawContext: unknown) {
          const call = (rawContext ?? {}) as { directory?: string; abort?: AbortSignal };
          const cwd = resolve(call.directory ?? context.cwd);
          const routedContext =
            contextForCwd?.(cwd) ??
            (cwd === context.cwd
              ? context
              : {
                  ...context,
                  cwd,
                  config: undefined,
                  linkValidator: context.linkValidator ?? createIssuesDesignDocsComposition({ cwd }).linkValidator,
                });
          try {
            const result = await definition.run({ ...routedContext, signal: call.abort }, args);
            return JSON.stringify(result);
          } catch (error: unknown) {
            return JSON.stringify(serializeDesignDocsError(error));
          }
        },
      });
      return [definition.name, registered];
    }),
  );
}

export interface OpenCodeDesignDocsOptions {
  readonly linkValidator?: DesignDocLinkValidator;
  readonly env?: NodeJS.ProcessEnv;
}

/** Creates the default real Issues/Design Docs composition with an injection seam for embedders. */
export function createDesignDocsPlugin(options: OpenCodeDesignDocsOptions = {}): Plugin {
  return async (ctx) => {
    const contexts = new Map<string, DesignDocsToolContext>();
    const contextForCwd = (requestedCwd: string): DesignDocsToolContext => {
      const cwd = resolve(requestedCwd);
      const existing = contexts.get(cwd);
      if (existing) return existing;
      const effective = resolveHostConfigSnapshot({
        cwd,
        env: options.env ?? process.env,
        interactive: false,
      });
      const context: DesignDocsToolContext = {
        cwd,
        interactive: false,
        config: effective.get(designDocsConfigContribution),
        linkValidator:
          options.linkValidator ?? createIssuesDesignDocsComposition({ cwd, snapshot: effective }).linkValidator,
        storeKey: {},
      };
      contexts.set(cwd, context);
      return context;
    };
    const context = contextForCwd(ctx.directory);
    return {
      tool: buildDesignDocsTools(context, tool, contextForCwd),
      dispose: async () => {
        await Promise.all([...contexts.values()].map(closeDesignDocsToolContext));
        contexts.clear();
      },
    };
  };
}

export const NeottiaDesignDocsPlugin = createDesignDocsPlugin();
export default NeottiaDesignDocsPlugin;
