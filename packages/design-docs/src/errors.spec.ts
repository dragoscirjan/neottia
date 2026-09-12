import { ResourceLimitError, StaleRevisionError } from '@neottia/repository-store';
import { describe, expect, it } from 'vitest';
import { asDesignDocsError, DesignDocsError, serializeDesignDocsError } from './errors.js';
import { structuredErrorSchema } from './schemas.js';

describe('Design Docs errors', () => {
  it('preserves repository-store retryability, evidence, and cause', () => {
    const source = new StaleRevisionError('stale', { expected: 'sha256:old', actual: 'sha256:new' });
    const error = asDesignDocsError(source);
    expect(error).toMatchObject({
      category: 'stale_revision',
      code: 'REVISION_MISMATCH',
      retryable: true,
      details: { expected: 'sha256:old', actual: 'sha256:new' },
      cause: source,
    });
    expect(asDesignDocsError(new ResourceLimitError('large')).retryable).toBe(false);
  });

  it('bounds and normalizes retained diagnostics deterministically', () => {
    const details = {
      z: '😀'.repeat(1000),
      array: Array.from({ length: 30 }, (_, index) => index),
      object: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`key-${index}`, index])),
      deep: { one: { two: { three: { four: { five: 'hidden' } } } } },
      infinite: Number.POSITIVE_INFINITY,
    };
    const error = new DesignDocsError('synchronization', 'BOUNDED', 'bounded', [], details);
    expect(error.retryable).toBe(false);
    expect(error.details?.detailsTruncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(error.details), 'utf8')).toBeLessThanOrEqual(16 * 1024);
    const keys = Object.keys(error.details ?? {}).filter((key) => key !== 'detailsTruncated');
    expect(keys).toEqual([...keys].sort());
  });

  it('bounds exponentially nested arrays with one aggregate item and JSON-byte budget', () => {
    let nested: unknown = 'leaf';
    for (let depth = 0; depth < 5; depth++) nested = Array.from({ length: 20 }, () => nested);
    const error = new DesignDocsError('synchronization', 'NESTED', 'nested', [], { nested });
    expect(error.details?.detailsTruncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(error.details), 'utf8')).toBeLessThanOrEqual(16 * 1024);
  });

  it('serializes a schema-valid required retryable field', () => {
    const serialized = serializeDesignDocsError(
      new DesignDocsError('cache', 'CACHE_STALE', 'stale', ['/tmp/cache'], { age: 10 }, { retryable: true }),
    );
    expect(serialized.retryable).toBe(true);
    expect(structuredErrorSchema.parse(serialized)).toEqual(serialized);
  });
});
