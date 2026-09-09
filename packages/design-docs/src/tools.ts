import { z } from 'zod';
import { loadDesignDocsConfig, type DesignDocsConfigInput } from './config.js';
import { DesignDocsError } from './errors.js';
import { DesignDocumentStore } from './store.js';
import {
  designDocsToolSchemas,
  documentArchiveInputSchema,
  documentCreateInputSchema,
  documentExportInputSchema,
  documentGetInputSchema,
  documentIdInputSchema,
  documentImportInputSchema,
  documentListInputSchema,
  documentRestoreInputSchema,
  documentSearchInputSchema,
  documentTransitionInputSchema,
  documentUpdateInputSchema,
  documentValidateInputSchema,
  documentVersionInputSchema,
  type DesignDocsToolName,
} from './tool-contracts.js';

export interface DesignDocsToolContext {
  readonly cwd: string;
  readonly interactive: boolean;
  readonly signal?: AbortSignal;
  readonly configOverrides?: Partial<DesignDocsConfigInput>;
  readonly onStaleCache?: () => boolean | Promise<boolean>;
  readonly storeKey?: object;
}
export interface DesignDocsToolDefinition {
  readonly name: DesignDocsToolName;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly outputSchema: z.ZodType;
  readonly errorSchema: z.ZodType;
  readonly run: (context: DesignDocsToolContext, input: unknown) => Promise<unknown>;
}
const contextStores = new WeakMap<object, Map<string, Promise<DesignDocumentStore>>>();

function storeFor(context: DesignDocsToolContext): Promise<DesignDocumentStore> {
  const key = context.storeKey ?? context;
  let stores = contextStores.get(key);
  if (!stores) {
    stores = new Map();
    contextStores.set(key, stores);
  }
  let store = stores.get(context.cwd);
  if (!store) {
    const config = loadDesignDocsConfig(context.cwd, context.configOverrides);
    store = DesignDocumentStore.fromConfig(config, context.cwd, { onStaleCache: context.onStaleCache });
    stores.set(context.cwd, store);
  }
  return store;
}

/** Forgets all project-routed stores associated with one host context. */
export async function closeDesignDocsToolContext(context: DesignDocsToolContext): Promise<void> {
  const key = context.storeKey ?? context;
  contextStores.delete(key);
}

function makeTool<I extends z.ZodObject, O extends z.ZodType>(
  name: DesignDocsToolName,
  description: string,
  inputSchema: I,
  outputSchema: O,
  handler: (store: DesignDocumentStore, input: z.output<I>, context: DesignDocsToolContext) => Promise<z.input<O>>,
): DesignDocsToolDefinition {
  return {
    name,
    description,
    inputSchema,
    outputSchema,
    errorSchema: designDocsToolSchemas[name].error,
    async run(context, input) {
      const parsedInput = inputSchema.safeParse(input);
      if (!parsedInput.success)
        throw new DesignDocsError(
          'schema',
          'TOOL_INPUT_INVALID',
          `Invalid ${name} input: ${z.prettifyError(parsedInput.error)}`,
        );
      const result = await handler(await storeFor(context), parsedInput.data, context);
      const parsedOutput = outputSchema.safeParse(result);
      if (!parsedOutput.success)
        throw new DesignDocsError(
          'schema',
          'TOOL_OUTPUT_INVALID',
          `Invalid ${name} output: ${z.prettifyError(parsedOutput.error)}`,
        );
      return parsedOutput.data;
    },
  };
}
const control = (context: DesignDocsToolContext) => ({ ...(context.signal ? { signal: context.signal } : {}) });

export const DESIGN_DOCS_TOOLS: readonly DesignDocsToolDefinition[] = [
  makeTool(
    'document_id',
    'Allocate a stable document ULID.',
    documentIdInputSchema,
    designDocsToolSchemas.document_id.output,
    (store, _input, context) => store.id(control(context)),
  ),
  makeTool(
    'document_create',
    'Create a draft design document.',
    documentCreateInputSchema,
    designDocsToolSchemas.document_create.output,
    (store, input, context) => store.create(input, control(context)),
  ),
  makeTool(
    'document_list',
    'List canonical document versions with filters.',
    documentListInputSchema,
    designDocsToolSchemas.document_list.output,
    async (store, input, context) => ({ documents: await store.list(input, control(context)) }),
  ),
  makeTool(
    'document_search',
    'BM25-ranked full-text search over the disposable Design Docs cache.',
    documentSearchInputSchema,
    designDocsToolSchemas.document_search.output,
    async (store, input, context) => ({ hits: await store.search(input, control(context)) }),
  ),
  makeTool(
    'document_get',
    'Get full canonical content by stable ID and optional version.',
    documentGetInputSchema,
    designDocsToolSchemas.document_get.output,
    (store, input, context) => store.get(input.id, input.version, control(context)),
  ),
  makeTool(
    'document_update',
    'Editorially update the current draft or review version using an exact revision.',
    documentUpdateInputSchema,
    designDocsToolSchemas.document_update.output,
    (store, { id, ...input }, context) => store.update(id, input, control(context)),
  ),
  makeTool(
    'document_transition',
    'Explicitly transition draft/review/approved state with caller intent and evidence.',
    documentTransitionInputSchema,
    designDocsToolSchemas.document_transition.output,
    (store, { id, ...input }, context) => store.transition(id, input, control(context)),
  ),
  makeTool(
    'document_version',
    'Create a draft semantic successor from the latest approved revision.',
    documentVersionInputSchema,
    designDocsToolSchemas.document_version.output,
    (store, { id, ...input }, context) => store.version(id, input, control(context)),
  ),
  makeTool(
    'document_validate',
    'Validate complete canonical lineages and the disposable cache.',
    documentValidateInputSchema,
    designDocsToolSchemas.document_validate.output,
    (store, input, context) => store.validate(input.id, control(context), { crossDomain: input.cross_domain }),
  ),
  makeTool(
    'document_archive',
    'Durably archive an entire lineage using its latest exact revision.',
    documentArchiveInputSchema,
    designDocsToolSchemas.document_archive.output,
    (store, input, context) => store.archive(input.id, input.expected_revision, control(context)),
  ),
  makeTool(
    'document_restore',
    'Durably restore an entire archived lineage.',
    documentRestoreInputSchema,
    designDocsToolSchemas.document_restore.output,
    (store, input, context) => store.restore(input.id, input.expected_revision, control(context)),
  ),
  makeTool(
    'document_export',
    'Export exact canonical bytes in a deterministic digested bundle.',
    documentExportInputSchema,
    designDocsToolSchemas.document_export.output,
    async (store, _input, context) => ({ content: await store.export(control(context)) }),
  ),
  makeTool(
    'document_import',
    'Preview or publish a bounded native/harnessctl-v2 migration bundle.',
    documentImportInputSchema,
    designDocsToolSchemas.document_import.output,
    (store, input, context) => store.import(input, control(context)),
  ),
];
export function findDesignDocsTool(name: string): DesignDocsToolDefinition | undefined {
  return DESIGN_DOCS_TOOLS.find((tool) => tool.name === name);
}
