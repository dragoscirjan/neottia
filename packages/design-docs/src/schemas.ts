import { z } from 'zod';
import { DOCUMENT_ID_PATTERN } from './identities.js';

export const DOCUMENT_KINDS = ['hld', 'lld', 'design-overview', 'gdd'] as const;
export const DOCUMENT_STATUSES = ['draft', 'review', 'approved'] as const;
export const documentKindSchema = z.enum(DOCUMENT_KINDS);
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
export const documentLocationSchema = z.enum(['active', 'archive']);
export const documentIdSchema = z.string().regex(DOCUMENT_ID_PATTERN);
export const byteRevisionSchema = z.string().regex(/^v1:[0-9a-f]{64}$/u);
export const canonicalTimestampSchema = z.iso.datetime({ offset: false, precision: 3 });

export const documentMetadataSchema = z
  .object({
    id: documentIdSchema,
    title: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value === value.trim(), 'must not have surrounding whitespace'),
    kind: documentKindSchema,
    status: documentStatusSchema,
    version: z.number().int().positive().safe(),
    created_at: canonicalTimestampSchema,
    updated_at: canonicalTimestampSchema,
    created_by: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value === value.trim(), 'must not have surrounding whitespace')
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const documentSummarySchema = z
  .object({
    id: documentIdSchema,
    path: z.string(),
    revision: byteRevisionSchema,
    location: documentLocationSchema,
    superseded: z.boolean(),
    archived: z.boolean(),
    title: z.string(),
    kind: documentKindSchema,
    status: documentStatusSchema,
    version: z.number().int().positive(),
  })
  .strict();

export const documentRecordSchema = documentSummarySchema
  .extend({
    metadata: documentMetadataSchema,
    body: z.string(),
  })
  .strict();

export const transitionEvidenceSchema = z
  .object({
    source: z.enum(['human-ui', 'caller-attestation', 'policy']),
    reference: z.string().trim().min(1).max(1000).optional(),
    note: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();

export const validationFindingSchema = z
  .object({
    document: documentIdSchema.optional(),
    path: z.string().optional(),
    category: z.string(),
    code: z.string(),
    message: z.string(),
  })
  .strict();

export const validationReportSchema = z
  .object({
    valid: z.boolean(),
    documents: z.number().int().nonnegative(),
    lineages: z.number().int().nonnegative(),
    findings: z.array(validationFindingSchema),
    cache: z.enum(['checked', 'rebuilt', 'skipped']),
  })
  .strict();

export const searchHitSchema = documentSummarySchema
  .extend({
    score: z.number(),
    snippet: z.string(),
  })
  .strict();

export const operationReportSchema = z
  .object({ id: documentIdSchema, location: documentLocationSchema, documents: z.array(documentSummarySchema) })
  .strict();

export const structuredErrorSchema = z
  .object({
    category: z.string(),
    code: z.string(),
    message: z.string(),
    paths: z.array(z.string()),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type DocumentKind = z.infer<typeof documentKindSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type DocumentLocation = z.infer<typeof documentLocationSchema>;
export type CanonicalDocumentMetadata = z.infer<typeof documentMetadataSchema>;
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type DocumentRecord = z.infer<typeof documentRecordSchema>;
export type TransitionEvidence = z.infer<typeof transitionEvidenceSchema>;
export type DocumentValidationReport = z.infer<typeof validationReportSchema>;
export type DocumentSearchHit = z.infer<typeof searchHitSchema>;
export type DocumentOperationReport = z.infer<typeof operationReportSchema>;
