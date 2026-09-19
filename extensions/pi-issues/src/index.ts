import { resolve } from 'node:path';
import { resolveHostConfigSnapshot } from '@neottia/config-registry';
import {
  closeIssueToolContext,
  issueConfigContribution,
  issueToolJsonSchema,
  ISSUE_TOOLS,
  type IssueConfigInput,
  type IssueToolContext,
  type IssueToolName,
  type DesignDocumentReferenceResolver,
} from '@neottia/issues';
import { createIssuesDesignDocsComposition } from '@neottia/issues-design-docs';
import type { PiExtensionApi as BasePiExtensionApi } from '@neottia/pi-adapter';
import { Type, type TSchema } from 'typebox';

/** Minimal Pi registration surface used by this extension. */
export type PiExtensionApi = BasePiExtensionApi<TSchema>;
export interface PiIssuesOptions {
  readonly cwd?: string;
  readonly configOverrides?: Partial<IssueConfigInput>;
  readonly resolver?: DesignDocumentReferenceResolver;
  readonly onStaleCache?: () => boolean | Promise<boolean>;
  readonly env?: NodeJS.ProcessEnv;
}

/** Pi schemas are generated from core Zod rather than maintained by adapters. */
export const issueToolParameters = Object.fromEntries(
  ISSUE_TOOLS.map((definition) => [
    definition.name,
    Type.Unsafe(issueToolJsonSchema(definition.name, 'input') as TSchema),
  ]),
) as unknown as Record<IssueToolName, TSchema>;

/** Registers first-class in-process issue tools and forwards cancellation. */
export function registerIssueTools(pi: PiExtensionApi, options: PiIssuesOptions = {}): () => Promise<void> {
  const contexts = new Map<
    string,
    { context: IssueToolContext; confirm?: (title: string, message: string) => Promise<boolean> }
  >();
  const defaultCwd = resolve(options.cwd ?? process.cwd());
  for (const definition of ISSUE_TOOLS)
    pi.registerTool({
      name: definition.name,
      label: definition.name
        .replace(/^issue_/u, '')
        .replace(/(^|_)([a-z])/gu, (_match, _separator, character: string) => character.toUpperCase()),
      description: definition.description,
      parameters: issueToolParameters[definition.name],
      async execute(_callId, params, signal, _onUpdate, invocation) {
        const cwd = resolve(invocation.cwd ?? defaultCwd);
        let state = contexts.get(cwd);
        if (!state) {
          const snapshot = resolveHostConfigSnapshot({
            cwd,
            interactive: true,
            env: options.env ?? process.env,
            ...(options.configOverrides ? { overrides: { modules: { issues: options.configOverrides } } } : {}),
          });
          state = {
            context: {
              cwd,
              interactive: true,
              config: snapshot.get(issueConfigContribution),
              resolver: options.resolver ?? createIssuesDesignDocsComposition({ cwd, snapshot }).resolver,
              storeKey: {},
            },
          };
          state.context = {
            ...state.context,
            onStaleCache:
              options.onStaleCache ??
              (() => state?.confirm?.('Issues cache is stale', 'Rebuild the issue search cache now?') ?? true),
          };
          contexts.set(cwd, state);
        }
        state.confirm = invocation.ui?.confirm;
        const result = await definition.run({ ...state.context, signal }, params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: { result } };
      },
    });
  return async () => {
    await Promise.all([...contexts.values()].map((state) => closeIssueToolContext(state.context)));
    contexts.clear();
  };
}

/** Pi extension entry point. */
export default function (pi: PiExtensionApi): void {
  pi.on('session_shutdown', registerIssueTools(pi));
}
