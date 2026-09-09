import { computeByteRevision } from '@neottia/repository-store';
import { isAlias, isMap, isScalar, isSeq, parseAllDocuments, stringify, type Node } from 'yaml';
import { IssueError } from './errors.js';
import { issueIdPattern } from './identities.js';
import { issueRecordSchema, type IssueRecord } from './schemas.js';

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_NODES = 100_000;
const MAX_DEPTH = 32;
const MAX_FILENAME_BYTES = 180;

/** Exact source bytes and semantic value returned by the safe codec. */
export interface DecodedIssue {
  readonly record: IssueRecord;
  readonly bytes: Uint8Array;
  readonly revision: `v1:${string}`;
  readonly canonical: boolean;
}

/** Decodes safe YAML while preserving the exact-byte optimistic revision. */
export function decodeIssue(bytes: Uint8Array, prefix = 'issue-', expectedId?: string): DecodedIssue {
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new IssueError('Issue file exceeds the 16 MiB limit.', 'validation', 'FILE_TOO_LARGE');
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch (error: unknown) {
    throw new IssueError('Issue file is not valid UTF-8.', 'validation', 'UTF8_INVALID', { cause: error });
  }
  const documents = parseAllDocuments(text, { uniqueKeys: true, strict: true });
  if (documents.length !== 1 || documents[0]?.errors.length)
    throw new IssueError(
      'Issue YAML must contain exactly one valid document with unique keys.',
      'validation',
      'YAML_INVALID',
    );
  const document = documents[0];
  if (!document) throw new IssueError('Issue YAML is empty.', 'validation', 'YAML_INVALID');
  inspectNode(document.contents, 0, { nodes: 0 });
  const parsed = issueRecordSchema.safeParse(document.toJS({ maxAliasCount: 0 }));
  if (!parsed.success)
    throw new IssueError(
      `Invalid issue record: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      'validation',
      'SCHEMA_INVALID',
    );
  if (!issueIdPattern(prefix).test(parsed.data.id))
    throw new IssueError(`Issue ID does not use configured prefix ${prefix}.`, 'validation', 'ID_INVALID', {
      details: { id: parsed.data.id },
    });
  if (expectedId !== undefined && expectedId !== parsed.data.id)
    throw new IssueError('Filename and body issue IDs differ.', 'validation', 'IDENTITY_MISMATCH', {
      details: { expectedId, actualId: parsed.data.id },
    });
  const canonicalBytes = encodeIssue(parsed.data);
  return {
    record: parsed.data,
    bytes,
    revision: `v1:${computeByteRevision(bytes).slice('sha256:'.length)}`,
    canonical: Buffer.compare(Buffer.from(bytes), Buffer.from(canonicalBytes)) === 0,
  };
}

/** Emits deterministic YAML in schema field order with one final newline. */
export function encodeIssue(input: IssueRecord): Uint8Array {
  const parsed = issueRecordSchema.parse(input);
  assertUnicodeValues(parsed, 'issue record');
  const ordered = {
    version: 1 as const,
    id: parsed.id,
    type: parsed.type,
    title: parsed.title,
    status: parsed.status,
    created_at: parsed.created_at,
    updated_at: parsed.updated_at,
    ...(parsed.created_by === undefined ? {} : { created_by: parsed.created_by }),
    ...(parsed.assigned_to === undefined ? {} : { assigned_to: parsed.assigned_to }),
    ...(parsed.parent === undefined ? {} : { parent: parsed.parent }),
    depends_on: [...parsed.depends_on].sort(),
    relates_to: [...parsed.relates_to].sort(),
    duplicates: [...parsed.duplicates].sort(),
    supersedes: [...parsed.supersedes].sort(),
    body: parsed.body,
    metadata: sortObject(parsed.metadata),
    comments: parsed.comments,
    links: [...parsed.links].sort((left, right) => compareCodePoints(linkKey(left), linkKey(right))),
  };
  const bytes = encoder.encode(stringify(ordered, { lineWidth: 0, sortMapEntries: false }));
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new IssueError('Encoded issue exceeds the 16 MiB limit.', 'validation', 'FILE_TOO_LARGE');
  return bytes;
}

/** Builds the deterministic canonical filename for an issue. */
export function issueFilename(id: string, title: string): string {
  const baseSlug =
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'untitled';
  const suffixBytes = Buffer.byteLength(`${id}-.yml`);
  const available = Math.max(1, MAX_FILENAME_BYTES - suffixBytes);
  let slug = '';
  for (const character of baseSlug) {
    if (Buffer.byteLength(slug + character) > available) break;
    slug += character;
  }
  slug = slug.replace(/-+$/u, '') || 'untitled'.slice(0, available);
  return `${id}-${slug}.yml`;
}

/** Extracts the stable identity without trusting the rest of a filename. */
export function filenameIssueId(path: string, prefix: string): string | undefined {
  const name = path.split('/').at(-1) ?? '';
  const match = new RegExp(
    `^((?:${escapeRegExp(prefix)}(?:[0-9]{5,}|[0-9A-HJKMNP-TV-Z]{26})|[0-9]{5,}))-.+\\.ya?ml$`,
    'u',
  ).exec(name);
  return match?.[1];
}

function inspectNode(node: Node | null, depth: number, state: { nodes: number }): void {
  if (node === null) return;
  if (depth > MAX_DEPTH || ++state.nodes > MAX_NODES)
    throw new IssueError('Issue YAML exceeds structural resource limits.', 'validation', 'YAML_LIMIT');
  if (isAlias(node)) throw new IssueError('YAML aliases are not allowed.', 'validation', 'YAML_ALIAS');
  if (
    node.tag &&
    ![
      'tag:yaml.org,2002:map',
      'tag:yaml.org,2002:seq',
      'tag:yaml.org,2002:str',
      'tag:yaml.org,2002:int',
      'tag:yaml.org,2002:float',
      'tag:yaml.org,2002:bool',
      'tag:yaml.org,2002:null',
    ].includes(node.tag)
  )
    throw new IssueError('Custom YAML tags are not allowed.', 'validation', 'YAML_TAG');
  if (isMap(node))
    for (const pair of node.items) {
      inspectNode(pair.key as Node, depth + 1, state);
      inspectNode(pair.value as Node | null, depth + 1, state);
    }
  else if (isSeq(node)) for (const item of node.items) inspectNode(item as Node | null, depth + 1, state);
  else if (!isScalar(node)) throw new IssueError('Unsupported YAML node.', 'validation', 'YAML_INVALID');
}

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, item]) => [key, canonicalMetadata(item)]),
  );
}

function canonicalMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalMetadata);
  if (value !== null && typeof value === 'object') return sortObject(value as Record<string, unknown>);
  return value;
}

/** Locale-independent ordering shared by canonical YAML and export. */
export function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function linkKey(link: { kind: string; id: string; version?: number }): string {
  return `${link.kind}\0${link.id}\0${link.version ?? ''}`;
}

function assertUnicodeValues(value: unknown, label: string): void {
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        if (index + 1 >= value.length) invalidUnicode(label);
        const next = value.charCodeAt(++index);
        if (next < 0xdc00 || next > 0xdfff) invalidUnicode(label);
      } else if (code >= 0xdc00 && code <= 0xdfff) invalidUnicode(label);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertUnicodeValues(item, label);
    return;
  }
  if (value !== null && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      assertUnicodeValues(key, label);
      assertUnicodeValues(item, label);
    }
}

function invalidUnicode(label: string): never {
  throw new IssueError(`${label} contains invalid Unicode.`, 'validation', 'UNICODE_INVALID');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
