import { resolve } from 'node:path';
import {
  closeDesignDocsToolContext,
  DESIGN_DOCS_TOOLS,
  serializeDesignDocsError,
  type DesignDocsToolContext,
  type DesignDocLinkValidator,
} from '@neottia/design-docs';
import { createIssuesDesignDocsComposition } from '@neottia/issues-design-docs';
import { tool, type Plugin } from '@opencode-ai/plugin';

export type OpenCodeToolFactory = typeof tool;

/** Builds in-process OpenCode tools directly from shared Zod shapes. */
export function buildDesignDocsTools(
  context: DesignDocsToolContext,
  toolFactory: OpenCodeToolFactory,
): Record<string, ReturnType<OpenCodeToolFactory>> {
  const validators = new Map<string, DesignDocLinkValidator>();
  return Object.fromEntries(
    DESIGN_DOCS_TOOLS.map((definition) => {
      const registered = toolFactory({
        description: definition.description,
        args: definition.inputSchema.shape,
        async execute(args: Record<string, unknown>, rawContext: unknown) {
          const call = (rawContext ?? {}) as { directory?: string; abort?: AbortSignal };
          const cwd = resolve(call.directory ?? context.cwd);
          let linkValidator = context.linkValidator;
          if (!linkValidator) {
            linkValidator = validators.get(cwd);
            if (!linkValidator) {
              linkValidator = createIssuesDesignDocsComposition({ cwd }).linkValidator;
              validators.set(cwd, linkValidator);
            }
          }
          try {
            const result = await definition.run({ ...context, cwd, linkValidator, signal: call.abort }, args);
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
}

/** Creates the default real Issues/Design Docs composition with an injection seam for embedders. */
export function createDesignDocsPlugin(options: OpenCodeDesignDocsOptions = {}): Plugin {
  return async (ctx) => {
    const context: DesignDocsToolContext = {
      cwd: resolve(ctx.directory),
      interactive: false,
      linkValidator: options.linkValidator,
      storeKey: {},
    };
    return { tool: buildDesignDocsTools(context, tool), dispose: () => closeDesignDocsToolContext(context) };
  };
}

export const NeottiaDesignDocsPlugin = createDesignDocsPlugin();
export default NeottiaDesignDocsPlugin;
