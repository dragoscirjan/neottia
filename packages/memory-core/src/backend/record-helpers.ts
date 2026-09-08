import { MemoryError } from '../errors.js';
import { createUlid } from '../identities.js';
import { memoryRecordSchema, memoryTombstoneSchema, type MemoryRecord, type MemoryTombstone } from '../schemas.js';
import type { SecretScanner } from '../security.js';
import type { MemoryRecordInput } from './filesystem.js';
import type { NamespaceScope } from './types.js';

/**
 * Record construction and validation shared by every storage backend:
 * identical semantics (scope assertion, secret scanning, compactness) with
 * backend-specific storage concerns kept out of here.
 */

const MUTATION_SUMMARY_CHARACTERS = 240;
const MUTATION_DETAILS_CHARACTERS = 2_000;
const MUTATION_DETAILS_LINES = 12;

export interface RecordHelperDeps {
  readonly scope: NamespaceScope;
  readonly scanner: SecretScanner;
  readonly defaultTopic: string;
}

/** Builds a validated record with a fresh ULID and the configured scope. */
export function makeRecord(
  deps: RecordHelperDeps,
  input: MemoryRecordInput,
  supersedes: string[],
  now: () => Date = () => new Date(),
): MemoryRecord {
  const record: MemoryRecord = {
    schema_version: 1,
    id: createUlid(now().getTime()),
    memory_type: input.memory_type,
    record_type: input.record_type,
    organization_id: deps.scope.organizationId,
    project_id: deps.scope.projectId,
    topic: input.topic ?? deps.defaultTopic,
    summary: input.summary,
    details: input.details ?? null,
    source: input.source,
    created_at: now().toISOString(),
    created_by: input.created_by,
    confidence: input.confidence,
    status: 'active',
    supersedes,
    tags: [...new Set(input.tags ?? [])].sort(),
  };
  return validateRecord(record, deps, 'memory record');
}

/** Validates and returns a tombstone for a target record. */
export function makeTombstone(
  deps: RecordHelperDeps,
  targetId: string,
  reason: string,
  source: MemoryTombstone['source'],
  createdBy: string,
  now: () => Date = () => new Date(),
): MemoryTombstone {
  if (typeof targetId !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(targetId))
    throw new MemoryError('target_id must be a Crockford ULID.');
  const tombstone: MemoryTombstone = {
    schema_version: 1,
    id: createUlid(now().getTime()),
    organization_id: deps.scope.organizationId,
    project_id: deps.scope.projectId,
    target_id: targetId,
    reason,
    source,
    created_at: now().toISOString(),
    created_by: createdBy,
  };
  return validateTombstone(tombstone, deps, 'memory tombstone');
}

/** Validates a canonical record against the schema, scope, and scanner. */
export function validateRecord(value: unknown, deps: RecordHelperDeps, label = 'memory record'): MemoryRecord {
  const result = memoryRecordSchema.safeParse(value);
  if (!result.success) throw new MemoryError(`Invalid ${label}:\n${formatIssues(result.error.issues)}`);
  assertScope(result.data, deps.scope);
  deps.scanner(result.data);
  return result.data;
}

/** Validates a canonical tombstone against the schema, scope, and scanner. */
export function validateTombstone(value: unknown, deps: RecordHelperDeps, label = 'memory tombstone'): MemoryTombstone {
  const result = memoryTombstoneSchema.safeParse(value);
  if (!result.success) throw new MemoryError(`Invalid ${label}:\n${formatIssues(result.error.issues)}`);
  assertScope(result.data, deps.scope);
  deps.scanner(result.data);
  return result.data;
}

/** Enforces write-time summary/details compactness (v1 semantics). */
export function validateCompactness(summary: string, details: string | null | undefined, context: string): void {
  const summaryCharacters = Array.from(summary).length;
  if (summaryCharacters > MUTATION_SUMMARY_CHARACTERS)
    throw new MemoryError(
      `${context}: summary has ${summaryCharacters} Unicode characters; limit is ${MUTATION_SUMMARY_CHARACTERS}.`,
    );
  if (details === undefined || details === null) return;
  const detailCharacters = Array.from(details).length;
  if (detailCharacters > MUTATION_DETAILS_CHARACTERS)
    throw new MemoryError(
      `${context}: details has ${detailCharacters} Unicode characters; limit is ${MUTATION_DETAILS_CHARACTERS}.`,
    );
  const nonEmptyLines = details.split(/\r\n|[\n\r\u2028\u2029]/u).filter((line) => line.trim()).length;
  if (nonEmptyLines > MUTATION_DETAILS_LINES)
    throw new MemoryError(
      `${context}: details has ${nonEmptyLines} non-empty lines; limit is ${MUTATION_DETAILS_LINES}.`,
    );
}

/** Canonical search text: summary + details + topic + tags, case-folded for FTS. */
export function searchableText(record: MemoryRecord): string {
  return [record.summary, record.details ?? '', record.topic, ...record.tags].join('\n').toLowerCase();
}

function assertScope(value: { organization_id: string; project_id: string }, scope: NamespaceScope): void {
  if (value.organization_id !== scope.organizationId || value.project_id !== scope.projectId)
    throw new MemoryError('Memory record scope does not match configured project namespace.');
}

function formatIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => `  - ${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
    .join('\n');
}

/**
 * Shared search-result collection: walks ranked IDs in rank order, applies
 * active/topic/type filters, and stops at the count limit or the JSON-size
 * budget. Both backends rank with their own engine; collection is identical.
 */
export function collectSearchResults(
  rankedIds: readonly string[],
  recordsById: ReadonlyMap<string, MemoryRecord>,
  options: {
    limit: number;
    maxChars: number;
    topic?: string;
    memoryType?: string;
    includeSuperseded?: boolean;
    activeIds: ReadonlySet<string>;
  },
): MemoryRecord[] {
  const results: MemoryRecord[] = [];
  let used = 0;
  for (const id of rankedIds) {
    if (results.length >= options.limit) return results;
    const record = recordsById.get(id);
    if (!record) continue;
    if (!(options.includeSuperseded ?? false) && !options.activeIds.has(record.id)) continue;
    if (options.topic && record.topic !== options.topic) continue;
    if (options.memoryType && record.memory_type !== options.memoryType) continue;
    const size = JSON.stringify(record).length;
    if (used + size > options.maxChars) return results;
    results.push(record);
    used += size;
  }
  return results;
}
