import {
  createSearchableRuntime,
  SEARCHABLE_TOOLS,
  type SearchableConfigInput,
  type SearchableRuntime,
  type SearchableRuntimeFactory,
} from '@neottia/searchable-core';
import { tool, type Plugin } from '@opencode-ai/plugin';

export type OpenCodeToolFactory = typeof tool;

/** Builds OpenCode definitions directly from the shared core registry. */
export function buildSearchableTools(
  context: {
    readonly cwd: string;
    readonly services: SearchableRuntime;
    readonly configOverrides?: Partial<SearchableConfigInput>;
  },
  factory: OpenCodeToolFactory,
): Record<string, ReturnType<OpenCodeToolFactory>> {
  return Object.fromEntries(
    SEARCHABLE_TOOLS.map((definition) => [
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

/** Options for runtime injection and configuration overrides. */
export interface SearchablePluginOptions {
  readonly configOverrides?: Partial<SearchableConfigInput>;
  readonly runtimeFactory?: SearchableRuntimeFactory;
}

/** Creates an in-process plugin that owns one runtime for the project directory. */
export function createSearchablePlugin(options: SearchablePluginOptions = {}): Plugin {
  return async (host) => {
    const runtime = (options.runtimeFactory ?? createSearchableRuntime)({
      cwd: host.directory,
      configOverrides: options.configOverrides,
    });
    return {
      tool: buildSearchableTools(
        { cwd: host.directory, services: runtime, configOverrides: options.configOverrides },
        tool,
      ),
      dispose: () => runtime.close(),
    };
  };
}

/** Default OpenCode plugin bound to the active project directory. */
export const NeottiaSearchablePlugin: Plugin = createSearchablePlugin();
export default NeottiaSearchablePlugin;
