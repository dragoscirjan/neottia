import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve } from 'node:path';
import { resolveHostConfigSnapshot } from '@neottia/config-registry';
import {
  asDesignDocsError,
  closeDesignDocsToolContext,
  DESIGN_DOCS_TOOLS,
  designDocsConfigContribution,
  DesignDocsError,
  designDocsToolJsonSchema,
  type DesignDocsConfigInput,
  type DesignDocsToolContext,
  type DesignDocsToolName,
  type DesignDocLinkValidator,
} from '@neottia/design-docs';
import { createIssuesDesignDocsComposition } from '@neottia/issues-design-docs';
import type { PiExtensionApi as BasePiExtensionApi } from '@neottia/pi-adapter';
import { Type, type TSchema } from 'typebox';

export type PiExtensionApi = BasePiExtensionApi<TSchema>;
export interface DesignDocsExtensionOptions {
  readonly cwd?: string;
  readonly configOverrides?: Partial<DesignDocsConfigInput>;
  readonly confirmTransition?: (target: 'review' | 'approved') => boolean | Promise<boolean>;
  readonly onStaleCache?: () => boolean | Promise<boolean>;
  readonly linkValidator?: DesignDocLinkValidator;
  readonly env?: NodeJS.ProcessEnv;
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
  type Confirm = (title: string, message: string) => Promise<boolean>;
  const confirmations = new AsyncLocalStorage<Confirm | undefined>();
  const contexts = new Map<string, DesignDocsToolContext>();
  const defaultCwd = resolve(options.cwd ?? process.cwd());
  for (const definition of DESIGN_DOCS_TOOLS) {
    pi.registerTool({
      name: definition.name,
      label: definition.name
        .replace(/^document_/, '')
        .replace(/(^|_)([a-z])/gu, (_match, _prefix, value: string) => value.toUpperCase()),
      description: definition.description,
      parameters: designDocsToolParameters[definition.name],
      async execute(_callId, params, signal, _onUpdate, invocation) {
        const cwd = resolve(invocation.cwd ?? defaultCwd);
        let context = contexts.get(cwd);
        if (!context) {
          const snapshot = resolveHostConfigSnapshot({
            cwd,
            interactive: true,
            env: options.env ?? process.env,
            ...(options.configOverrides ? { overrides: { modules: { design_docs: options.configOverrides } } } : {}),
          });
          const linkValidator =
            options.linkValidator ?? createIssuesDesignDocsComposition({ cwd, snapshot }).linkValidator;
          context = {
            cwd,
            interactive: true,
            config: snapshot.get(designDocsConfigContribution),
            linkValidator,
            storeKey: {},
            onStaleCache:
              options.onStaleCache ??
              (() =>
                confirmations.getStore()?.('Design Docs cache is stale', 'Rebuild the Design Docs search cache now?') ??
                true),
          };
          contexts.set(cwd, context);
        }
        if (definition.name === 'document_transition' && (params['to'] === 'review' || params['to'] === 'approved')) {
          const target = params['to'];
          const confirmed = options.confirmTransition
            ? await options.confirmTransition(target)
            : await (invocation.ui?.confirm('Design document transition', `Proceed with transition to ${target}?`) ??
                true);
          if (!confirmed)
            throw new DesignDocsError('lifecycle', 'TRANSITION_DECLINED', `Transition to ${target} was declined.`);
        }
        try {
          const result = await confirmations.run(invocation.ui?.confirm, () =>
            definition.run({ ...context, signal }, params),
          );
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: {} };
        } catch (error: unknown) {
          throw asDesignDocsError(error);
        }
      },
    });
  }
  return async () => {
    await Promise.all([...contexts.values()].map(closeDesignDocsToolContext));
    contexts.clear();
  };
}
export default function (pi: PiExtensionApi): void {
  const close = registerDesignDocsTools(pi);
  pi.on('session_shutdown', close);
}
