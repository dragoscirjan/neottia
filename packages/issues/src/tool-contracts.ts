import { z } from 'zod';
import {
  designDocumentReferenceSchema,
  issueLocationSchema,
  issueSchema,
  issueStatusSchema,
  issueTypeSchema,
  issueValidationReportSchema,
} from './schemas.js';

const id = z.string().min(5).max(64);
const revision = z.string().regex(/^v1:[0-9a-f]{64}$/u);
const nonblank = z.string().min(1).regex(/\S/u);
const controlFields = { deadline: z.number().int().positive().optional() };
const listFilters = {
  status: issueStatusSchema.optional(),
  type: issueTypeSchema.optional(),
  assignee: nonblank.optional(),
  parent: id.optional(),
  location: issueLocationSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
const issueOutput = issueSchema;
const issuesOutput = z.object({ issues: z.array(issueSchema) }).strict();
const relation = z.enum(['depends_on', 'relates_to', 'duplicates', 'supersedes']);

export const issueIdInputSchema = z.object(controlFields).strict();
export const issueCreateInputSchema = z
  .object({
    type: issueTypeSchema,
    title: nonblank.max(500),
    body: z
      .string()
      .max(1024 * 1024)
      .optional(),
    created_by: nonblank.optional(),
    assigned_to: nonblank.optional(),
    parent: id.optional(),
    metadata: z.record(z.string(), z.json()).optional(),
    ...controlFields,
  })
  .strict();
export const issueGetInputSchema = z.object({ id, ...controlFields }).strict();
export const issueListInputSchema = z.object({ ...listFilters, ...controlFields }).strict();
export const issueSearchInputSchema = z
  .object({
    query: z
      .string()
      .max(16 * 1024)
      .trim()
      .min(1),
    ...listFilters,
    max_bytes: z
      .number()
      .int()
      .min(1024)
      .max(16 * 1024 * 1024)
      .optional(),
    ...controlFields,
  })
  .strict();
export const issueUpdateInputSchema = z
  .object({
    id,
    expected_revision: revision,
    title: nonblank.max(500).optional(),
    body: z
      .string()
      .max(1024 * 1024)
      .optional(),
    assigned_to: nonblank.nullable().optional(),
    parent: id.nullable().optional(),
    metadata: z.record(z.string(), z.json()).optional(),
    ...controlFields,
  })
  .strict()
  .refine(
    (value) => ['title', 'body', 'assigned_to', 'parent', 'metadata'].some((field) => field in value),
    'At least one mutable field is required.',
  );
export const issueTransitionInputSchema = z
  .object({ id, status: issueStatusSchema, expected_revision: revision, ...controlFields })
  .strict();
export const issueCommentInputSchema = z
  .object({
    id,
    author: nonblank,
    body: nonblank.max(64 * 1024),
    expected_revision: revision.optional(),
    ...controlFields,
  })
  .strict();
export const issueRelateInputSchema = z
  .object({
    source_id: id,
    target_id: id,
    relationship: relation,
    expected_revision: revision.optional(),
    ...controlFields,
  })
  .strict();
export const issueUnrelateInputSchema = issueRelateInputSchema.required({ expected_revision: true });
export const issueLinkInputSchema = z
  .object({
    id,
    document_id: z.string().regex(/^doc-(?:[0-9]{5,}|[0-9A-HJKMNP-TV-Z]{26})$/u),
    document_version: z.number().int().positive().optional(),
    expected_revision: revision.optional(),
    ...controlFields,
  })
  .strict();
export const issueUnlinkInputSchema = issueLinkInputSchema.required({ expected_revision: true });
export const issueValidateInputSchema = z.object(controlFields).strict();
export const issueArchiveInputSchema = z.object({ id, expected_revision: revision, ...controlFields }).strict();
export const issueRestoreInputSchema = issueArchiveInputSchema;
export const issueExportInputSchema = z.object(controlFields).strict();
export const issueImportInputSchema = z
  .object({ content: z.string().max(64 * 1024 * 1024), preview: z.boolean().optional(), ...controlFields })
  .strict();

export const issueImportReportSchema = z
  .object({
    valid: z.boolean(),
    preview: z.boolean(),
    planned: z.number().int().nonnegative(),
    imported: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
    errors: z.array(z.string()),
  })
  .strict();
export const issueExportOutputSchema = z
  .object({ format: z.literal('neottia-issues-v1'), content: z.string(), count: z.number().int().nonnegative() })
  .strict();

/** Authoritative input/output schemas for all seventeen issue tools. */
export const issueToolSchemas = {
  issue_id: { input: issueIdInputSchema, output: z.object({ id }).strict() },
  issue_create: { input: issueCreateInputSchema, output: issueOutput },
  issue_get: { input: issueGetInputSchema, output: issueOutput },
  issue_list: { input: issueListInputSchema, output: issuesOutput },
  issue_search: { input: issueSearchInputSchema, output: issuesOutput },
  issue_update: { input: issueUpdateInputSchema, output: issueOutput },
  issue_transition: { input: issueTransitionInputSchema, output: issueOutput },
  issue_comment: { input: issueCommentInputSchema, output: issueOutput },
  issue_relate: { input: issueRelateInputSchema, output: issueOutput },
  issue_unrelate: { input: issueUnrelateInputSchema, output: issueOutput },
  issue_link_document: { input: issueLinkInputSchema, output: issueOutput },
  issue_unlink_document: { input: issueUnlinkInputSchema, output: issueOutput },
  issue_validate: { input: issueValidateInputSchema, output: issueValidationReportSchema },
  issue_archive: { input: issueArchiveInputSchema, output: issuesOutput },
  issue_restore: { input: issueRestoreInputSchema, output: issuesOutput },
  issue_export: { input: issueExportInputSchema, output: issueExportOutputSchema },
  issue_import: { input: issueImportInputSchema, output: issueImportReportSchema },
} as const;

export type IssueToolName = keyof typeof issueToolSchemas;
export type IssueToolInput<Name extends IssueToolName> = z.output<(typeof issueToolSchemas)[Name]['input']>;
export type IssueToolOutput<Name extends IssueToolName> = z.output<(typeof issueToolSchemas)[Name]['output']>;

/** Generates host JSON Schema from the same runtime Zod contract. */
export function issueToolJsonSchema(name: IssueToolName, boundary: 'input' | 'output'): Record<string, unknown> {
  return z.toJSONSchema(issueToolSchemas[name][boundary]) as Record<string, unknown>;
}

export { designDocumentReferenceSchema };
