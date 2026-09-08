import { z } from 'zod';
import { ULID_PATTERN } from './identities.js';
import { memoryDocumentSchema, memoryRecordSchema, memoryTombstoneSchema } from './schemas.js';

/** Runtime and publication limits shared by every memory tool surface. */
export const MEMORY_TOOL_LIMITS = {
  summaryCharacters: 240,
  detailsCharacters: 2_000,
  detailsLines: 12,
  queryBytes: 16 * 1024,
  importBytes: 64 * 1024 * 1024,
  exportBytes: 64 * 1024 * 1024,
} as const;

const ulid = z.string().regex(ULID_PATTERN, 'must be a Crockford ULID');
const nonempty = z.string().min(1).regex(/\S/, 'must not be blank');

function countUnicodeCharacters(value: string, limit: number): number {
  let count = 0;
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    count++;
    if (count > limit) return count;
  }
  return count;
}

function compactText(maxCharacters: number, label: string): z.ZodString {
  const schema = z
    .string()
    .superRefine((value, context) => {
      if (countUnicodeCharacters(value, maxCharacters) > maxCharacters)
        context.addIssue({
          code: 'custom',
          message: `${label} must be at most ${maxCharacters} Unicode characters.`,
        });
    })
    .describe(`${label}; at most ${maxCharacters} Unicode code points.`);
  // JSON Schema maxLength counts Unicode code points, while Zod's native max
  // check counts UTF-16 code units. Runtime therefore retains the refinement.
  return schema.meta({ maxLength: maxCharacters, 'x-neottia-length-unit': 'unicode-code-points' });
}

function countNonEmptyLines(value: string, limit: number): number {
  let count = 0;
  let lineHasContent = false;
  let previousWasCarriageReturn = false;
  for (const character of value) {
    if (character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029') {
      if (character === '\n' && previousWasCarriageReturn) {
        previousWasCarriageReturn = false;
        continue;
      }
      if (lineHasContent) {
        count++;
        if (count > limit) return count;
      }
      lineHasContent = false;
      previousWasCarriageReturn = character === '\r';
      continue;
    }
    previousWasCarriageReturn = false;
    if (!/^\s$/u.test(character)) lineHasContent = true;
  }
  if (lineHasContent) count++;
  return count;
}

function byteBoundedText(maxBytes: number, label: string): z.ZodString {
  return z
    .string()
    .refine((value) => Buffer.byteLength(value, 'utf8') <= maxBytes, `${label} exceeds ${maxBytes} UTF-8 bytes.`)
    .describe(`${label}; at most ${maxBytes} UTF-8 bytes.`)
    .meta({ 'x-neottia-max-utf8-bytes': maxBytes });
}

const summaryInput = compactText(MEMORY_TOOL_LIMITS.summaryCharacters, 'Summary').min(1);
const detailsInput = compactText(MEMORY_TOOL_LIMITS.detailsCharacters, 'Details')
  .superRefine((value, context) => {
    const lines = countNonEmptyLines(value, MEMORY_TOOL_LIMITS.detailsLines);
    if (lines > MEMORY_TOOL_LIMITS.detailsLines)
      context.addIssue({
        code: 'custom',
        message: `Details must have at most ${MEMORY_TOOL_LIMITS.detailsLines} non-empty lines.`,
      });
  })
  .describe(
    `Details; at most ${MEMORY_TOOL_LIMITS.detailsCharacters} Unicode code points and ${MEMORY_TOOL_LIMITS.detailsLines} non-empty lines.`,
  )
  .meta({
    maxLength: MEMORY_TOOL_LIMITS.detailsCharacters,
    'x-neottia-length-unit': 'unicode-code-points',
    'x-neottia-max-nonempty-lines': MEMORY_TOOL_LIMITS.detailsLines,
  });

const sourceSchema = z
  .object({
    kind: z.enum(['artifact', 'user-confirmed', 'discussion', 'tool-observation']),
    ref: z.string().nullable(),
    revision: z.string().nullable(),
  })
  .strict();

export const storeInputSchema = z
  .object({
    memory_type: z.enum(['semantic', 'episodic', 'procedural']),
    record_type: z.enum(['fact', 'decision', 'event', 'lesson']),
    topic: nonempty.optional(),
    summary: summaryInput,
    details: detailsInput.nullable().optional(),
    source: sourceSchema,
    created_by: nonempty,
    confidence: z.enum(['confirmed', 'verified']),
    tags: z
      .array(nonempty)
      .superRefine((values, context) => {
        if (new Set(values).size !== values.length)
          context.addIssue({ code: 'custom', message: 'Tags must be unique.' });
      })
      .meta({ uniqueItems: true })
      .optional(),
  })
  .strict();

export const supersedeInputSchema = storeInputSchema.extend({ target_id: ulid }).strict();
export const deleteInputSchema = z
  .object({ target_id: ulid, reason: z.string().min(1).max(1000), source: sourceSchema, created_by: nonempty })
  .strict();
export const getInputSchema = z.object({ id: ulid }).strict();
export const listInputSchema = z
  .object({
    topic: nonempty.optional(),
    memory_type: z.enum(['semantic', 'episodic', 'procedural']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    include_superseded: z.boolean().optional(),
  })
  .strict();
export const searchInputSchema = listInputSchema
  .extend({
    query: byteBoundedText(MEMORY_TOOL_LIMITS.queryBytes, 'Query').min(1),
    max_chars: z.number().int().min(256).max(100_000).optional(),
  })
  .strict();
export const validateInputSchema = z.object({}).strict();
export const exportInputSchema = z.object({}).strict();
export const importInputSchema = z
  .object({
    content: byteBoundedText(MEMORY_TOOL_LIMITS.importBytes, 'Import content'),
    preview: z.boolean().optional(),
  })
  .strict();

const cacheValidationSchema = z.union([
  z
    .object({
      outcome: z.enum(['checked', 'rebuilt']),
      evidence: z.enum(['canonical_snapshot_match_verified', 'canonical_snapshot_rebuild_verified']),
    })
    .strict(),
  z.object({ outcome: z.literal('skipped'), evidence: z.literal('memory_validation_failed') }).strict(),
]);

export const validationReportSchema = z
  .object({
    valid: z.boolean(),
    records: z.number().int().nonnegative(),
    tombstones: z.number().int().nonnegative(),
    errors: z.array(z.string()),
    cache: cacheValidationSchema,
  })
  .strict();
export const importReportSchema = z
  .object({
    valid: z.boolean(),
    records: z.number().int().nonnegative(),
    tombstones: z.number().int().nonnegative(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()).optional(),
  })
  .strict();

/** Canonical input and output schemas for the complete nine-tool surface. */
export const memoryToolSchemas = {
  memory_store: { input: storeInputSchema, output: memoryRecordSchema },
  memory_supersede: { input: supersedeInputSchema, output: memoryRecordSchema },
  memory_delete: { input: deleteInputSchema, output: memoryTombstoneSchema },
  memory_get: { input: getInputSchema, output: memoryDocumentSchema },
  memory_list: { input: listInputSchema, output: z.array(memoryRecordSchema) },
  memory_search: { input: searchInputSchema, output: z.array(memoryRecordSchema) },
  memory_validate: { input: validateInputSchema, output: validationReportSchema },
  memory_export: {
    input: exportInputSchema,
    output: byteBoundedText(MEMORY_TOOL_LIMITS.exportBytes, 'Export content'),
  },
  memory_import: { input: importInputSchema, output: importReportSchema },
} as const;

export type MemoryToolName = keyof typeof memoryToolSchemas;

/** Converts one canonical schema for hosts that consume JSON Schema. */
export function memoryToolJsonSchema(name: MemoryToolName, boundary: 'input' | 'output'): Record<string, unknown> {
  return z.toJSONSchema(memoryToolSchemas[name][boundary]) as Record<string, unknown>;
}

export type MemoryToolInput<Name extends MemoryToolName> = z.output<(typeof memoryToolSchemas)[Name]['input']>;
export type MemoryToolOutput<Name extends MemoryToolName> = z.output<(typeof memoryToolSchemas)[Name]['output']>;
export type StoreMemoryInput = z.output<typeof storeInputSchema>;
export type MemoryValidationReport = z.output<typeof validationReportSchema>;
export type ImportReport = z.output<typeof importReportSchema>;
