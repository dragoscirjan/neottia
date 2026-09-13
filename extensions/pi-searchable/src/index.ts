import { resolve } from 'node:path';
import {
  createSearchableRuntime,
  searchableToolJsonSchema,
  SEARCHABLE_TOOLS,
  type SearchableConfigInput,
  type SearchableRuntime,
  type SearchableRuntimeFactory,
  type SearchableToolName,
} from '@neottia/searchable-core';
import { Type, type TSchema } from 'typebox';

/** Minimal Pi registration contract used by the extension and its tests. */
export interface PiExtensionApi {
  on(event: 'session_shutdown', handler: () => Promise<void>): unknown;
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: TSchema;
    execute(
      callId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      context: { cwd?: string; ui?: { confirm(title: string, message: string): Promise<boolean> } },
    ): Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> }>;
  }): unknown;
}

/** Host options for CWD routing, configuration, and deterministic runtime tests. */
export interface SearchableExtensionOptions {
  readonly cwd?: string;
  readonly configOverrides?: Partial<SearchableConfigInput>;
  readonly runtimeFactory?: SearchableRuntimeFactory;
  readonly onStaleCache?: () => boolean | Promise<boolean>;
}

/** Pi parameters generated from the single core schema registry. */
export const searchableToolParameters = Object.fromEntries(
  SEARCHABLE_TOOLS.map((definition) => [
    definition.name,
    Type.Unsafe(searchableToolJsonSchema(definition.name, 'input') as TSchema),
  ]),
) as unknown as Record<SearchableToolName, TSchema>;

/** Registers all Searchable tools and owns one runtime per invocation CWD. */
export function registerSearchableTools(
  pi: PiExtensionApi,
  options: SearchableExtensionOptions = {},
): () => Promise<void> {
  const runtimes = new Map<string, SearchableRuntime>();
  const defaultCwd = resolve(options.cwd ?? process.cwd());
  for (const definition of SEARCHABLE_TOOLS)
    pi.registerTool({
      name: definition.name,
      label: definition.name
        .replace(/^web_/u, '')
        .replace(/(^|_)([a-z])/gu, (_match, _separator, value: string) => value.toUpperCase()),
      description: definition.description,
      parameters: searchableToolParameters[definition.name],
      async execute(_callId, params, signal, _onUpdate, invocation) {
        const cwd = resolve(invocation.cwd ?? defaultCwd);
        let runtime = runtimes.get(cwd);
        if (!runtime) {
          runtime = (options.runtimeFactory ?? createSearchableRuntime)({
            cwd,
            configOverrides: options.configOverrides,
          });
          runtimes.set(cwd, runtime);
        }
        const result = await definition.run(
          {
            cwd,
            services: runtime,
            signal,
            configOverrides: options.configOverrides,
            onStaleCache:
              options.onStaleCache ??
              (() =>
                invocation.ui?.confirm('Searchable cache is stale', 'Rebuild the stash search cache now?') ?? true),
          },
          params,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          details: { result },
        };
      },
    });
  return async () => {
    const results = await Promise.allSettled([...runtimes.values()].map((runtime) => runtime.close()));
    runtimes.clear();
    const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    if (errors.length) throw new AggregateError(errors, 'Searchable Pi shutdown failed.');
  };
}

/** Pi extension entry point. Options support deterministic host lifecycle tests. */
export default function (pi: PiExtensionApi, options: SearchableExtensionOptions = {}): void {
  pi.on('session_shutdown', registerSearchableTools(pi, options));
}
