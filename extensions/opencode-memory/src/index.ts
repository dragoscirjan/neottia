import { closeMemoryToolContext, MEMORY_TOOLS, type MemoryToolContext } from '@neottia/memory-core';
import { tool, type Plugin } from '@opencode-ai/plugin';

/**
 * OpenCode plugin: registers the nine `memory_*` tools as first-class
 * OpenCode tools, running in-process (no MCP hop). The tool names and input
 * contracts are identical to the MCP server and the pi extension.
 *
 * Loaded from project `.opencode/plugins/` files or as an npm package in the
 * opencode config's `plugin` array.
 */

/** The real OpenCode tool helper, injected by the host. */
export type OpenCodeToolFactory = typeof tool;

/**
 * Builds the OpenCode `tool` hook map. Exported for unit testing with a
 * fake tool factory; the default plugin uses the real one.
 *
 * Note: the shape objects originate from @neottia/memory-core's zod; the
 * runtime values are zod-4-compatible with the plugin host, and the store
 * re-validates everything anyway.
 */
export function buildMemoryTools(
  context: MemoryToolContext,
  toolFactory: OpenCodeToolFactory,
): Record<string, ReturnType<OpenCodeToolFactory>> {
  return Object.fromEntries(
    MEMORY_TOOLS.map((memoryTool) => {
      const definition = toolFactory({
        description: memoryTool.description,
        args: memoryTool.inputSchema.shape,
        async execute(args: Record<string, unknown>) {
          const result = await memoryTool.run(context, args);
          return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        },
      });
      return [memoryTool.name, definition];
    }),
  );
}

/** OpenCode plugin entry point. */
export const NeottiaMemoryPlugin: Plugin = async (ctx) => {
  const context: MemoryToolContext = {
    cwd: ctx.directory,
    // OpenCode has no stable confirmation API in the plugin contract; the
    // default plugin therefore follows the non-interactive rebuild behavior.
    interactive: false,
  };
  return {
    tool: buildMemoryTools(context, tool),
    dispose: () => closeMemoryToolContext(context),
  };
};

export default NeottiaMemoryPlugin;
