import type { DeepReadonly, ResolvedConfigSnapshot } from '@neottia/config';
import { resolveHostConfigSnapshot } from '@neottia/config-registry';
import { buildOpencodeTools } from '@neottia/opencode-adapter';
import {
  createSearchableRuntime,
  SEARCHABLE_TOOLS,
  searchableConfigContribution,
  type SearchableConfig,
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
    readonly config: DeepReadonly<SearchableConfig>;
  },
  factory: OpenCodeToolFactory,
): Record<string, ReturnType<OpenCodeToolFactory>> {
  return buildOpencodeTools(SEARCHABLE_TOOLS, context, factory);
}

/** Options for snapshot, environment, overrides, and runtime injection. */
export interface SearchablePluginOptions {
  readonly snapshot?: ResolvedConfigSnapshot;
  readonly env?: NodeJS.ProcessEnv;
  readonly configOverrides?: Partial<SearchableConfigInput>;
  readonly runtimeFactory?: SearchableRuntimeFactory;
}

/** Creates an in-process plugin that owns one runtime for the project directory. */
export function createSearchablePlugin(options: SearchablePluginOptions = {}): Plugin {
  return async (host) => {
    const snapshot = resolveHostConfigSnapshot({
      cwd: host.directory,
      interactive: false,
      ...(options.snapshot ? { snapshot: options.snapshot } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...(options.configOverrides ? { overrides: { modules: { searchable: options.configOverrides } } } : {}),
    });
    const config = snapshot.get(searchableConfigContribution);
    const runtime = (options.runtimeFactory ?? createSearchableRuntime)({ cwd: host.directory, config });
    return {
      tool: buildSearchableTools({ cwd: host.directory, services: runtime, config }, tool),
      dispose: () => runtime.close(),
    };
  };
}

/** Default OpenCode plugin bound to the active project directory. */
export const NeottiaSearchablePlugin: Plugin = createSearchablePlugin();
export default NeottiaSearchablePlugin;
