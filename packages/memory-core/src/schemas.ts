import { z } from 'zod';
import { ULID_PATTERN } from './identities.js';

/**
 * Memory record and tombstone schemas, ported from the harnessctl-v2
 * reference implementation (v1 record fidelity per neottia#1 decisions).
 * Classification pairings and verified-source constraints are enforced here.
 */

export const memoryTypeSchema = z.enum(['semantic', 'episodic', 'procedural']);
export const recordTypeSchema = z.enum(['fact', 'decision', 'event', 'lesson']);
export const sourceKindSchema = z.enum(['artifact', 'user-confirmed', 'discussion', 'tool-observation']);
export const confidenceSchema = z.enum(['confirmed', 'verified']);

const nonemptyString = z.string().min(1).regex(/\S/, 'must not be blank');
const ulidSchema = z.string().regex(ULID_PATTERN, 'must be a Crockford ULID');

const memorySourceSchema = z
  .object({
    kind: sourceKindSchema,
    ref: z.string().nullable(),
    revision: z.string().nullable(),
  })
  .strict();

export const memoryRecordSchema = z
  .object({
    schema_version: z.literal(1),
    id: ulidSchema,
    memory_type: memoryTypeSchema,
    record_type: recordTypeSchema,
    organization_id: nonemptyString,
    project_id: nonemptyString,
    topic: nonemptyString,
    summary: nonemptyString.max(1000),
    details: z.string().max(12_000).nullable(),
    source: memorySourceSchema,
    created_at: z.iso.datetime(),
    created_by: nonemptyString,
    confidence: confidenceSchema,
    status: z.literal('active'),
    supersedes: z.array(ulidSchema).meta({ uniqueItems: true }),
    tags: z.array(nonemptyString).meta({ uniqueItems: true }),
  })
  .strict()
  .superRefine((record, context) => {
    const validPair =
      (record.memory_type === 'semantic' && record.record_type === 'fact') ||
      (record.memory_type === 'episodic' && ['decision', 'event'].includes(record.record_type)) ||
      (record.memory_type === 'procedural' && record.record_type === 'lesson');
    if (!validPair)
      context.addIssue({
        code: 'custom',
        path: ['record_type'],
        message: `is incompatible with memory_type ${record.memory_type}`,
      });
    if (record.confidence === 'verified' && !['artifact', 'tool-observation'].includes(record.source.kind))
      context.addIssue({
        code: 'custom',
        path: ['source', 'kind'],
        message: 'must be artifact or tool-observation when confidence is verified',
      });
    if (record.supersedes.includes(record.id))
      context.addIssue({ code: 'custom', path: ['supersedes'], message: 'must not contain record id' });
    addDuplicateIssue(record.supersedes, ['supersedes'], context);
    addDuplicateIssue(record.tags, ['tags'], context);
  });

export const memoryTombstoneSchema = z
  .object({
    schema_version: z.literal(1),
    id: ulidSchema,
    organization_id: nonemptyString,
    project_id: nonemptyString,
    target_id: ulidSchema,
    reason: nonemptyString.max(1000),
    source: memorySourceSchema,
    created_at: z.iso.datetime(),
    created_by: nonemptyString,
  })
  .strict();

export const memoryDocumentSchema = z.union([memoryRecordSchema, memoryTombstoneSchema]);

export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type RecordType = z.infer<typeof recordTypeSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type MemorySource = z.infer<typeof memorySourceSchema>;
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type MemoryTombstone = z.infer<typeof memoryTombstoneSchema>;

function addDuplicateIssue(values: string[], path: string[], context: z.RefinementCtx): void {
  if (new Set(values).size !== values.length)
    context.addIssue({ code: 'custom', path, message: 'must contain unique values' });
}
