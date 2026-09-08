import { describe, expect, it } from 'vitest';
import { createUlid, isUlid, ULID_PATTERN } from './identities.js';
import { memoryRecordSchema, memoryTombstoneSchema } from './schemas.js';
import { looksHighEntropy } from './security.js';

const ZERO_ENTROPY = (): Uint8Array => new Uint8Array(10);
const MAX_ENTROPY = (): Uint8Array => new Uint8Array(10).fill(0xff);

describe('strict ULID identities', () => {
  it('accepts the 128-bit boundary and rejects overflow encodings', () => {
    expect(isUlid('00000000000000000000000000')).toBe(true);
    expect(isUlid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(true);
    expect(isUlid('80000000000000000000000000')).toBe(false);
    expect(isUlid('ZZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(false);
  });

  it('creates the minimum and maximum representable ULIDs', () => {
    expect(createUlid(0, ZERO_ENTROPY)).toBe('00000000000000000000000000');
    expect(createUlid(0xffff_ffff_ffff, MAX_ENTROPY)).toBe('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(() => createUlid(0x1_0000_0000_0000, ZERO_ENTROPY)).toThrow(RangeError);
  });

  it('shares the strict range across schemas and the entropy exemption', () => {
    const base = {
      schema_version: 1 as const,
      id: '80000000000000000000000000',
      organization_id: 'local',
      project_id: 'project',
      source: { kind: 'artifact' as const, ref: null, revision: null },
      created_at: '2025-01-01T00:00:00.000Z',
      created_by: 'test',
    };
    expect(
      memoryRecordSchema.safeParse({
        ...base,
        memory_type: 'semantic',
        record_type: 'fact',
        topic: 'general',
        summary: 'boundary',
        details: null,
        confidence: 'verified',
        status: 'active',
        supersedes: [],
        tags: [],
      }).success,
    ).toBe(false);
    expect(
      memoryTombstoneSchema.safeParse({ ...base, target_id: '00000000000000000000000000', reason: 'boundary' }).success,
    ).toBe(false);
    expect(ULID_PATTERN.test('80000000000000000000000000')).toBe(false);
    expect(looksHighEntropy('80000000000000000000000000')).toBe(false);
  });
});
