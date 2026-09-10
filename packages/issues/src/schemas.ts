import { z } from 'zod';

/** Canonical issue classifications and lifecycle states. */
export const issueTypeSchema = z.enum(['initiative', 'epic', 'story', 'task', 'bug']);
export const issueStatusSchema = z.enum(['open', 'in_progress', 'done', 'closed']);
export const issueLocationSchema = z.enum(['active', 'archive']);
const id = z
  .string()
  .min(5)
  .max(64)
  .regex(/^(?:[a-z][a-z0-9-]*(?:[0-9]{5,}|[0-9A-HJKMNP-TV-Z]{26})|[0-9]{5,})$/u);
const timestamp = z.iso.datetime({ offset: true });
const nonblank = z.string().min(1).max(1024).regex(/\S/u, 'must not be blank');
const uniqueIds = z
  .array(id)
  .max(1000)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: 'IDs must be unique.' });
  });

/** Stable external target identity persisted in issue YAML. */
export const designDocumentReferenceSchema = z
  .object({
    kind: z.literal('design-doc'),
    id: z.string().regex(/^doc-(?:[0-9]{5,}|[0-9A-HJKMNP-TV-Z]{26})$/u),
    version: z.number().int().positive().safe().optional(),
  })
  .strict();

/** Embedded comments are immutable after append. */
export const issueCommentSchema = z
  .object({
    id: z.string().regex(/^(?:comment-[0-9A-HJKMNP-TV-Z]{26}|[0-9]{5,}-C[0-9]{4,})$/u),
    author: nonblank,
    body: z
      .string()
      .min(1)
      .max(64 * 1024)
      .regex(/\S/u, 'must not be blank'),
    created_at: timestamp,
  })
  .strict();

/** v1 canonical YAML record. Derived inverse relations are intentionally absent. */
export const issueRecordSchema = z
  .object({
    version: z.literal(1),
    id,
    type: issueTypeSchema,
    title: z.string().min(1).max(500).regex(/\S/u, 'must not be blank'),
    status: issueStatusSchema,
    created_at: timestamp,
    updated_at: timestamp,
    created_by: nonblank.optional(),
    assigned_to: nonblank.optional(),
    parent: id.optional(),
    depends_on: uniqueIds.default([]),
    relates_to: uniqueIds.default([]),
    duplicates: uniqueIds.default([]),
    supersedes: uniqueIds.default([]),
    body: z
      .string()
      .max(1024 * 1024)
      .default(''),
    metadata: z.record(z.string(), z.json()).default({}),
    comments: z.array(issueCommentSchema).max(10_000).default([]),
    links: z.array(designDocumentReferenceSchema).max(1000).default([]),
  })
  .strict()
  .superRefine((record, context) => {
    if (Date.parse(record.updated_at) < Date.parse(record.created_at))
      context.addIssue({ code: 'custom', path: ['updated_at'], message: 'updated_at cannot precede created_at.' });
    const commentIds = record.comments.map((comment) => comment.id);
    if (new Set(commentIds).size !== commentIds.length)
      context.addIssue({ code: 'custom', path: ['comments'], message: 'Comment IDs must be unique.' });
    const linkKeys = record.links.map((link) => `${link.kind}\0${link.id}\0${link.version ?? ''}`);
    if (new Set(linkKeys).size !== linkKeys.length)
      context.addIssue({ code: 'custom', path: ['links'], message: 'Links must be unique.' });
  });

/** Complete hydrated result returned by read and mutation tools. */
export const issueSchema = issueRecordSchema
  .safeExtend({
    revision: z.string().regex(/^v1:[0-9a-f]{64}$/u),
    location: issueLocationSchema,
    children: uniqueIds,
    blocks: uniqueIds,
    blocked_by: uniqueIds,
    related_to: uniqueIds,
  })
  .strict();

export const validationFindingSchema = z
  .object({
    severity: z.enum(['error', 'warning']),
    code: z.string(),
    message: z.string(),
    id: z.string().optional(),
    path: z.string().optional(),
    recovery_hint: z.string().optional(),
  })
  .strict();

export const issueValidationReportSchema = z
  .object({
    valid: z.boolean(),
    issues: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
    findings: z.array(validationFindingSchema).max(1000),
    cache: z.enum(['checked', 'rebuilt', 'skipped']),
  })
  .strict();

export type IssueType = z.output<typeof issueTypeSchema>;
export type IssueStatus = z.output<typeof issueStatusSchema>;
export type IssueLocation = z.output<typeof issueLocationSchema>;
export type DesignDocumentReference = z.output<typeof designDocumentReferenceSchema>;
export type IssueComment = z.output<typeof issueCommentSchema>;
export type IssueRecord = z.output<typeof issueRecordSchema>;
export type Issue = z.output<typeof issueSchema>;
export type IssueValidationReport = z.output<typeof issueValidationReportSchema>;
