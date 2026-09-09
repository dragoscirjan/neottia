import {
  closeDesignDocsToolContext,
  DESIGN_DOCS_TOOLS,
  serializeDesignDocsError,
  type DesignDocsToolContext,
} from '@neottia/design-docs';
import { tool, type Plugin } from '@opencode-ai/plugin';

export type OpenCodeToolFactory = typeof tool;

/** Builds in-process OpenCode tools directly from shared Zod shapes. */
export function buildDesignDocsTools(
  context: DesignDocsToolContext,
  toolFactory: OpenCodeToolFactory,
): Record<string, ReturnType<OpenCodeToolFactory>> {
  return Object.fromEntries(
    DESIGN_DOCS_TOOLS.map((definition) => {
      const registered = toolFactory({
        description: definition.description,
        args: definition.inputSchema.shape,
        async execute(args: Record<string, unknown>, rawContext: unknown) {
          const call = (rawContext ?? {}) as { directory?: string; abort?: AbortSignal };
          try {
            const result = await definition.run(
              { ...context, cwd: call.directory ?? context.cwd, signal: call.abort },
              args,
            );
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

export const NeottiaDesignDocsPlugin: Plugin = async (ctx) => {
  const context: DesignDocsToolContext = { cwd: ctx.directory, interactive: false, storeKey: {} };
  return { tool: buildDesignDocsTools(context, tool), dispose: () => closeDesignDocsToolContext(context) };
};
export default NeottiaDesignDocsPlugin;
