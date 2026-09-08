import {
  closeMemoryToolContext,
  memoryToolJsonSchema,
  MEMORY_TOOLS,
  type MemoryToolContext,
  type MemoryToolName,
} from '@neottia/memory-core';
import { Type, type TSchema } from 'typebox';

/**
 * pi extension: registers the nine `memory_*` tools as first-class pi tools.
 * The tools run in-process (no MCP hop) and share the exact contract of the
 * MCP server and the library tool layer.
 *
 * pi loads extensions through jiti, so this TypeScript file ships as-is.
 * Pi accepts JSON Schema parameters, generated from the authoritative Zod
 * runtime contracts in @neottia/memory-core.
 */

/** Minimal structural type of the pi ExtensionAPI surface we use. */
export interface PiExtensionApi {
  on: (event: 'session_shutdown', handler: () => Promise<void>) => unknown;
  registerTool: (tool: {
    name: string;
    label?: string;
    description: string;
    parameters: TSchema;
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      ctx: unknown,
    ) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, never> }>;
  }) => unknown;
}

export interface MemoryExtensionOptions {
  /** Working directory of the project whose memory shard is used. */
  readonly cwd?: string;
  /** Overrides merged into the resolved memory config shard. */
  readonly configOverrides?: Record<string, unknown>;
  /** Optional confirmation callback for stale-cache rebuilds. */
  readonly onStaleCache?: () => boolean | Promise<boolean>;
}

/** Pi parameters generated losslessly from the core Zod contracts. */
export const memoryToolParameters = Object.fromEntries(
  MEMORY_TOOLS.map((tool) => [tool.name, Type.Unsafe(memoryToolJsonSchema(tool.name, 'input') as TSchema)]),
) as unknown as Record<MemoryToolName, TSchema>;

/**
 * Registers the memory tools on a pi extension API instance.
 * Exported separately from `default` so tests can drive it with a fake API.
 */
export function registerMemoryTools(pi: PiExtensionApi, options: MemoryExtensionOptions = {}): () => Promise<void> {
  const storeKey = {};
  const context: MemoryToolContext = {
    cwd: options.cwd ?? process.cwd(),
    interactive: true,
    configOverrides: options.configOverrides,
    storeKey,
  };

  for (const tool of MEMORY_TOOLS) {
    const parameters = memoryToolParameters[tool.name];
    if (!parameters) continue;
    pi.registerTool({
      name: tool.name,
      label: tool.name
        .replace(/^memory_/, '')
        .replace(/(^|_)([a-z])/gu, (_, __, character: string) => character.toUpperCase()),
      description: tool.description,
      parameters,
      async execute(_toolCallId, params, _signal, _onUpdate, toolContext) {
        const uiContext = toolContext as { ui?: { confirm: (title: string, message: string) => Promise<boolean> } };
        const callContext: MemoryToolContext = {
          ...context,
          onStaleCache:
            options.onStaleCache ??
            (() => uiContext.ui?.confirm('Memory cache is stale', 'Rebuild the memory search cache now?') ?? true),
        };
        const result = await tool.run(callContext, params);
        return {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
          details: {},
        };
      },
    });
  }
  return () => closeMemoryToolContext(context);
}

/** pi extension entry point. */
export default function (pi: PiExtensionApi): void {
  const close = registerMemoryTools(pi);
  pi.on('session_shutdown', close);
}
