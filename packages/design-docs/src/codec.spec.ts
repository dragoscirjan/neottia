import { describe, expect, it } from 'vitest';
import { canonicalDocumentFilename, decodeDocument, encodeCanonicalDocument } from './codec.js';
import { designDocsConfigSchema } from './config.js';

const limits = designDocsConfigSchema.parse({}).security.limits;
const metadata = {
  id: 'doc-01ARZ3NDEKTSV4RRFFQ69G5FAV',
  title: 'Cache & Search',
  kind: 'hld' as const,
  status: 'draft' as const,
  version: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  metadata: { owner: 'platform', nested: [true, 1] },
};

describe('canonical Design Docs codec', () => {
  it('round-trips deterministic bytes, filename, and exact v1 revision', () => {
    const bytes = encodeCanonicalDocument(metadata, '## Decision\n\nUse FTS5.', limits);
    const decoded = decodeDocument(bytes, limits);
    expect(decoded.metadata).toEqual(metadata);
    expect(decoded.revision).toMatch(/^v1:[0-9a-f]{64}$/u);
    expect(canonicalDocumentFilename(metadata)).toBe('doc-01ARZ3NDEKTSV4RRFFQ69G5FAV-cache-search-v1.md');
    expect(encodeCanonicalDocument(decoded.metadata, decoded.content, limits)).toEqual(bytes);
  });

  it.each([
    [
      'BOM',
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(encodeCanonicalDocument(metadata, '', limits))]),
    ],
    [
      'CRLF',
      Buffer.from(
        Buffer.from(encodeCanonicalDocument(metadata, '', limits))
          .toString()
          .replaceAll('\n', '\r\n'),
      ),
    ],
  ])('rejects unsafe or noncanonical %s input', (_name, source) => {
    expect(() => decodeDocument(source, limits)).toThrow();
  });

  it('rejects an ATX H1 injected after the canonical title', () => {
    const source = Buffer.from(encodeCanonicalDocument(metadata, '## valid', limits))
      .toString()
      .replace('## valid', '# invalid');
    expect(() => decodeDocument(source, limits)).toThrow(/level-one|canonical/u);
  });

  it('rejects padded canonical fields and sorts nested metadata keys deterministically', () => {
    expect(() => encodeCanonicalDocument({ ...metadata, title: ' Padded ' }, '', limits)).toThrow(/whitespace/u);
    expect(() => encodeCanonicalDocument({ ...metadata, created_by: ' padded ' }, '', limits)).toThrow(/whitespace/u);
    const left = encodeCanonicalDocument({ ...metadata, metadata: { z: { b: 2, a: 1 }, a: true } }, '', limits);
    const right = encodeCanonicalDocument({ ...metadata, metadata: { a: true, z: { a: 1, b: 2 } } }, '', limits);
    expect(left).toEqual(right);
    expect(Buffer.from(left).toString()).toContain('metadata: {"a":true,"z":{"a":1,"b":2}}');
  });

  it('rejects trailing unpaired high surrogates before encoding', () => {
    expect(() => encodeCanonicalDocument({ ...metadata, title: `Invalid\ud800` }, '', limits)).toThrow(
      /invalid Unicode/u,
    );
    expect(() => encodeCanonicalDocument(metadata, `Invalid\ud800`, limits)).toThrow(/invalid Unicode/u);
  });

  it('rejects Setext H1 syntax outside fenced code', () => {
    expect(() => encodeCanonicalDocument(metadata, 'Other heading\n=====', limits)).toThrow(/level-one/u);
    expect(() => encodeCanonicalDocument(metadata, '```md\nOther heading\n=====\n```', limits)).not.toThrow();
  });

  it('rejects aliases, unknown keys, and filename-independent H1 mismatches', () => {
    const canonical = Buffer.from(encodeCanonicalDocument(metadata, '', limits)).toString();
    expect(() => decodeDocument(canonical.replace('kind: hld', 'kind: hld\nunknown: true'), limits)).toThrow(
      /Unsupported/u,
    );
    expect(() =>
      decodeDocument(
        canonical.replace('metadata: {', 'metadata: &meta {').replace('---\n\n', 'copy: *meta\n---\n\n'),
        limits,
      ),
    ).toThrow();
    expect(() => decodeDocument(canonical.replace('# Cache & Search', '# Wrong'), limits)).toThrow(/matching H1/u);
  });
});
