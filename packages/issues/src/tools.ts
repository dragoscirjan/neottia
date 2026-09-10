import { z } from 'zod';
import { loadIssueConfig, type IssueConfigInput } from './config.js';
import { IssueError } from './errors.js';
import type { DesignDocumentReferenceResolver } from './resolver.js';
import { IssueStore } from './store.js';
import { issueToolSchemas, type IssueToolName } from './tool-contracts.js';

/** Per-host context shared by Pi, OpenCode, and MCP. */
export interface IssueToolContext {
  readonly cwd: string;
  readonly interactive: boolean;
  readonly signal?: AbortSignal;
  readonly configOverrides?: Partial<IssueConfigInput>;
  readonly onStaleCache?: () => boolean | Promise<boolean>;
  readonly resolver?: DesignDocumentReferenceResolver;
  readonly storeKey?: object;
}

export interface IssueToolDefinition {
  readonly name: IssueToolName;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly outputSchema: z.ZodType;
  readonly run: (context: IssueToolContext, input: unknown) => Promise<unknown>;
}

const stores = new WeakMap<object, IssueStore>();
function storeFor(context: IssueToolContext): IssueStore {
  const key = context.storeKey ?? context;
  const existing = stores.get(key);
  if (existing) return existing;
  const store = new IssueStore(loadIssueConfig(context.cwd, context.configOverrides), context.cwd, {
    resolver: context.resolver,
    onStaleCache: context.onStaleCache,
  });
  stores.set(key, store);
  return store;
}

/** Forgets a host context; IssueStore itself retains no open native handles. */
export async function closeIssueToolContext(context: IssueToolContext): Promise<void> {
  stores.delete(context.storeKey ?? context);
}

function makeTool<I extends z.ZodObject, O extends z.ZodType>(
  name: IssueToolName,
  description: string,
  inputSchema: I,
  outputSchema: O,
  handler: (store: IssueStore, input: z.output<I>, context: IssueToolContext) => Promise<z.input<O>>,
): IssueToolDefinition {
  return {
    name,
    description,
    inputSchema,
    outputSchema,
    async run(context, input) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success)
        throw new IssueError(
          `Invalid ${name} input: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
          'validation',
          'TOOL_INPUT_INVALID',
        );
      const store = storeFor(context);
      const output = await handler(store, parsed.data, context);
      const validated = outputSchema.safeParse(output);
      if (!validated.success)
        throw new IssueError(`Invalid ${name} output: ${validated.error.message}`, 'validation', 'TOOL_OUTPUT_INVALID');
      if (Buffer.byteLength(JSON.stringify(validated.data), 'utf8') > store.config.security.max_result_bytes)
        throw new IssueError(
          'Serialized tool output exceeds the configured byte limit.',
          'validation',
          'RESULT_TOO_LARGE',
          {
            details: { maxBytes: store.config.security.max_result_bytes },
          },
        );
      return validated.data;
    },
  };
}

function control(input: { deadline?: number }, context: IssueToolContext): { signal?: AbortSignal; deadline?: number } {
  return {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
  };
}

/** Shared executable registry consumed verbatim by all host surfaces. */
export const ISSUE_TOOLS: readonly IssueToolDefinition[] = [
  makeTool(
    'issue_id',
    'Generate a collision-checked issue ULID.',
    issueToolSchemas.issue_id.input,
    issueToolSchemas.issue_id.output,
    (store, input, context) => store.id(control(input, context)),
  ),
  makeTool(
    'issue_create',
    'Create a canonical issue.',
    issueToolSchemas.issue_create.input,
    issueToolSchemas.issue_create.output,
    (store, input, context) => store.create(input, control(input, context)),
  ),
  makeTool(
    'issue_get',
    'Get an active or archived issue by stable ID.',
    issueToolSchemas.issue_get.input,
    issueToolSchemas.issue_get.output,
    (store, input, context) => store.get(input.id, control(input, context)),
  ),
  makeTool(
    'issue_list',
    'List issues with exact filters.',
    issueToolSchemas.issue_list.input,
    issueToolSchemas.issue_list.output,
    async (store, input, context) => ({ issues: [...(await store.list(input, control(input, context)))] }),
  ),
  makeTool(
    'issue_search',
    'Rank canonical issues using SQLite FTS5/BM25.',
    issueToolSchemas.issue_search.input,
    issueToolSchemas.issue_search.output,
    async (store, input, context) => ({
      issues: [
        ...(await store.search(
          input.query,
          { ...input, ...(input.max_bytes === undefined ? {} : { maxBytes: input.max_bytes }) },
          control(input, context),
        )),
      ],
    }),
  ),
  makeTool(
    'issue_update',
    'Update mutable issue fields with exact revision evidence.',
    issueToolSchemas.issue_update.input,
    issueToolSchemas.issue_update.output,
    (store, input, context) => store.update(input.id, input.expected_revision, input, control(input, context)),
  ),
  makeTool(
    'issue_transition',
    'Transition issue status with exact revision evidence.',
    issueToolSchemas.issue_transition.input,
    issueToolSchemas.issue_transition.output,
    (store, input, context) =>
      store.transition(input.id, input.status, input.expected_revision, control(input, context)),
  ),
  makeTool(
    'issue_comment',
    'Append an immutable issue comment.',
    issueToolSchemas.issue_comment.input,
    issueToolSchemas.issue_comment.output,
    (store, input, context) =>
      store.comment(input.id, input.author, input.body, input.expected_revision, control(input, context)),
  ),
  makeTool(
    'issue_relate',
    'Add an idempotent issue relationship.',
    issueToolSchemas.issue_relate.input,
    issueToolSchemas.issue_relate.output,
    (store, input, context) => store.relate(input, control(input, context)),
  ),
  makeTool(
    'issue_unrelate',
    'Remove an issue relationship with revision evidence.',
    issueToolSchemas.issue_unrelate.input,
    issueToolSchemas.issue_unrelate.output,
    (store, input, context) => store.unrelate(input, control(input, context)),
  ),
  makeTool(
    'issue_link_document',
    'Link a stable typed design-document identity.',
    issueToolSchemas.issue_link_document.input,
    issueToolSchemas.issue_link_document.output,
    (store, input, context) =>
      store.linkDocument(
        input.id,
        {
          kind: 'design-doc',
          id: input.document_id,
          ...(input.document_version === undefined ? {} : { version: input.document_version }),
        },
        input.expected_revision,
        control(input, context),
      ),
  ),
  makeTool(
    'issue_unlink_document',
    'Remove a typed design-document link with revision evidence.',
    issueToolSchemas.issue_unlink_document.input,
    issueToolSchemas.issue_unlink_document.output,
    (store, input, context) =>
      store.unlinkDocument(
        input.id,
        {
          kind: 'design-doc',
          id: input.document_id,
          ...(input.document_version === undefined ? {} : { version: input.document_version }),
        },
        input.expected_revision,
        control(input, context),
      ),
  ),
  makeTool(
    'issue_validate',
    'Validate canonical graph and disposable cache.',
    issueToolSchemas.issue_validate.input,
    issueToolSchemas.issue_validate.output,
    (store, input, context) => store.validate(control(input, context)),
  ),
  makeTool(
    'issue_archive',
    'Recursively archive an issue subtree.',
    issueToolSchemas.issue_archive.input,
    issueToolSchemas.issue_archive.output,
    async (store, input, context) => ({
      issues: [...(await store.archive(input.id, input.expected_revision, control(input, context)))],
    }),
  ),
  makeTool(
    'issue_restore',
    'Recursively restore an issue subtree.',
    issueToolSchemas.issue_restore.input,
    issueToolSchemas.issue_restore.output,
    async (store, input, context) => ({
      issues: [...(await store.restore(input.id, input.expected_revision, control(input, context)))],
    }),
  ),
  makeTool(
    'issue_export',
    'Export a deterministic native issue snapshot.',
    issueToolSchemas.issue_export.input,
    issueToolSchemas.issue_export.output,
    (store, input, context) => store.export(control(input, context)),
  ),
  makeTool(
    'issue_import',
    'Preview or import native/legacy issue content.',
    issueToolSchemas.issue_import.input,
    issueToolSchemas.issue_import.output,
    (store, input, context) => store.import(input.content, input.preview ?? true, control(input, context)),
  ),
];

/** Finds one canonical tool definition by external name. */
export function findIssueTool(name: string): IssueToolDefinition | undefined {
  return ISSUE_TOOLS.find((tool) => tool.name === name);
}
