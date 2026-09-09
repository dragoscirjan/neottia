import {
  closeDesignDocsToolContext,
  DESIGN_DOCS_TOOLS,
  DesignDocsError,
  designDocsToolJsonSchema,
  type DesignDocsToolContext,
  type DesignDocsToolName,
} from '@neottia/design-docs';
import { Type, type TSchema } from 'typebox';

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
    ) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> }>;
  }) => unknown;
}
export interface DesignDocsExtensionOptions {
  readonly cwd?: string;
  readonly configOverrides?: Record<string, unknown>;
  readonly confirmTransition?: (target: 'review' | 'approved') => boolean | Promise<boolean>;
}
export const designDocsToolParameters = Object.fromEntries(
  DESIGN_DOCS_TOOLS.map((definition) => [
    definition.name,
    Type.Unsafe(designDocsToolJsonSchema(definition.name, 'input') as TSchema),
  ]),
) as unknown as Record<DesignDocsToolName, TSchema>;

/** Registers shared contracts while resolving the active worktree per invocation. */
export function registerDesignDocsTools(
  pi: PiExtensionApi,
  options: DesignDocsExtensionOptions = {},
): () => Promise<void> {
  const storeKey = {};
  const base: DesignDocsToolContext = {
    cwd: options.cwd ?? process.cwd(),
    interactive: true,
    configOverrides: options.configOverrides,
    storeKey,
  };
  for (const definition of DESIGN_DOCS_TOOLS) {
    pi.registerTool({
      name: definition.name,
      label: definition.name
        .replace(/^document_/, '')
        .replace(/(^|_)([a-z])/gu, (_match, _prefix, value: string) => value.toUpperCase()),
      description: definition.description,
      parameters: designDocsToolParameters[definition.name],
      async execute(_callId, params, signal, _onUpdate, rawContext) {
        const toolContext = rawContext as {
          cwd?: string;
          ui?: { confirm(title: string, message: string): Promise<boolean> };
        };
        if (definition.name === 'document_transition' && (params['to'] === 'review' || params['to'] === 'approved')) {
          const target = params['to'];
          const confirmed = options.confirmTransition
            ? await options.confirmTransition(target)
            : await (toolContext.ui?.confirm('Design document transition', `Proceed with transition to ${target}?`) ??
                true);
          if (!confirmed)
            throw new DesignDocsError('lifecycle', 'TRANSITION_DECLINED', `Transition to ${target} was declined.`);
        }
        const result = await definition.run({ ...base, cwd: toolContext.cwd ?? base.cwd, signal }, params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: {} };
      },
    });
  }
  return () => closeDesignDocsToolContext(base);
}
export default function (pi: PiExtensionApi): void {
  const close = registerDesignDocsTools(pi);
  pi.on('session_shutdown', close);
}
