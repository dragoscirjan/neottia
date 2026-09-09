import { z } from 'zod';
import {
  byteRevisionSchema,
  documentIdSchema,
  documentKindSchema,
  documentLocationSchema,
  documentRecordSchema,
  documentStatusSchema,
  documentSummarySchema,
  operationReportSchema,
  searchHitSchema,
  structuredErrorSchema,
  transitionEvidenceSchema,
  validationReportSchema,
} from './schemas.js';

const nonempty = z.string().trim().min(1);
const metadata = z.record(z.string(), z.unknown());
const content = z.string();
const idVersion = z.object({ id: documentIdSchema, version: z.number().int().positive().optional() }).strict();
export const documentIdInputSchema = z.object({}).strict();
export const documentCreateInputSchema = z
  .object({
    title: nonempty.max(200),
    kind: documentKindSchema,
    created_by: nonempty.max(200).optional(),
    body: content.optional(),
    metadata: metadata.optional(),
  })
  .strict();
export const documentListInputSchema = z
  .object({
    kind: documentKindSchema.optional(),
    status: documentStatusSchema.optional(),
    location: documentLocationSchema.optional(),
    id: documentIdSchema.optional(),
    current_only: z.boolean().optional(),
    limit: z.number().int().positive().max(1000).optional(),
  })
  .strict();
export const documentSearchInputSchema = z
  .object({
    query: nonempty,
    kind: documentKindSchema.optional(),
    status: documentStatusSchema.optional(),
    location: documentLocationSchema.optional(),
    id: documentIdSchema.optional(),
    all_versions: z.boolean().optional(),
    limit: z.number().int().positive().max(1000).optional(),
  })
  .strict();
export const documentGetInputSchema = idVersion;
export const documentUpdateInputSchema = z
  .object({
    id: documentIdSchema,
    expected_revision: byteRevisionSchema,
    title: nonempty.max(200).optional(),
    kind: documentKindSchema.optional(),
    body: content.optional(),
    metadata: metadata.nullable().optional(),
  })
  .strict();
export const documentTransitionInputSchema = z
  .object({
    id: documentIdSchema,
    expected_revision: byteRevisionSchema,
    to: documentStatusSchema,
    intent: nonempty.max(1000),
    actor: nonempty.max(200),
    evidence: transitionEvidenceSchema,
  })
  .strict();
export const documentVersionInputSchema = documentUpdateInputSchema;
export const documentValidateInputSchema = z
  .object({ id: documentIdSchema.optional(), cross_domain: z.boolean().optional() })
  .strict();
export const documentArchiveInputSchema = z
  .object({ id: documentIdSchema, expected_revision: byteRevisionSchema })
  .strict();
export const documentRestoreInputSchema = documentArchiveInputSchema;
export const documentExportInputSchema = z.object({}).strict();
export const documentImportInputSchema = z
  .object({ content, preview: z.boolean().optional(), format: z.enum(['native', 'harnessctl-v2']).optional() })
  .strict();
const exportOutputSchema = z.object({ content: z.string() }).strict();
const importOutputSchema = z
  .object({
    preview: z.boolean(),
    valid: z.boolean(),
    additions: z.number().int().nonnegative(),
    conflicts: z.array(z.string()),
    unsupported: z.array(z.string()),
    warnings: z.array(z.string()),
    path_mappings: z.array(
      z
        .object({
          legacy_path: z.string(),
          id: documentIdSchema,
          version: z.number().int().positive(),
          neottia_path: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

/** The sole Zod-derived contract for all library, MCP, Pi, and OpenCode tools. */
export const designDocsToolSchemas = {
  document_id: {
    input: documentIdInputSchema,
    output: z.object({ id: documentIdSchema }).strict(),
    error: structuredErrorSchema,
  },
  document_create: { input: documentCreateInputSchema, output: documentRecordSchema, error: structuredErrorSchema },
  document_list: {
    input: documentListInputSchema,
    output: z.object({ documents: z.array(documentSummarySchema) }).strict(),
    error: structuredErrorSchema,
  },
  document_search: {
    input: documentSearchInputSchema,
    output: z.object({ hits: z.array(searchHitSchema) }).strict(),
    error: structuredErrorSchema,
  },
  document_get: { input: documentGetInputSchema, output: documentRecordSchema, error: structuredErrorSchema },
  document_update: { input: documentUpdateInputSchema, output: documentRecordSchema, error: structuredErrorSchema },
  document_transition: {
    input: documentTransitionInputSchema,
    output: documentRecordSchema,
    error: structuredErrorSchema,
  },
  document_version: { input: documentVersionInputSchema, output: documentRecordSchema, error: structuredErrorSchema },
  document_validate: {
    input: documentValidateInputSchema,
    output: validationReportSchema,
    error: structuredErrorSchema,
  },
  document_archive: { input: documentArchiveInputSchema, output: operationReportSchema, error: structuredErrorSchema },
  document_restore: { input: documentRestoreInputSchema, output: operationReportSchema, error: structuredErrorSchema },
  document_export: { input: documentExportInputSchema, output: exportOutputSchema, error: structuredErrorSchema },
  document_import: { input: documentImportInputSchema, output: importOutputSchema, error: structuredErrorSchema },
} as const;
export type DesignDocsToolName = keyof typeof designDocsToolSchemas;
export type DesignDocsToolInput<Name extends DesignDocsToolName> = z.output<
  (typeof designDocsToolSchemas)[Name]['input']
>;
export type DesignDocsToolOutput<Name extends DesignDocsToolName> = z.output<
  (typeof designDocsToolSchemas)[Name]['output']
>;
export function designDocsToolJsonSchema(
  name: DesignDocsToolName,
  boundary: 'input' | 'output' | 'error',
): Record<string, unknown> {
  return z.toJSONSchema(designDocsToolSchemas[name][boundary]) as Record<string, unknown>;
}
