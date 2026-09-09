import { computeByteRevision } from '@neottia/repository-store';
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Node, type Scalar } from 'yaml';
import type { DesignDocsLimits } from './config.js';
import { DesignDocsError } from './errors.js';
import { assertDocumentId } from './identities.js';
import { documentMetadataSchema, type CanonicalDocumentMetadata } from './schemas.js';

export type DocumentRevision = `v1:${string}`;

export interface DecodedDocument {
  readonly metadata: CanonicalDocumentMetadata;
  readonly body: string;
  readonly content: string;
  readonly bytes: Uint8Array;
  readonly revision: DocumentRevision;
}

const ALLOWED_KEYS = new Set([
  'id',
  'title',
  'kind',
  'status',
  'version',
  'created_at',
  'updated_at',
  'created_by',
  'metadata',
]);
const encoder = new TextEncoder();

/** Returns the only portable canonical filename for a document version. */
export function canonicalDocumentFilename(
  metadata: Pick<CanonicalDocumentMetadata, 'id' | 'title' | 'version'>,
): string {
  const filename = `${metadata.id}-${slug(metadata.title)}-v${metadata.version}.md`;
  // Keep the ASCII component below common 255-byte portable filesystem limits.
  if (Buffer.byteLength(filename, 'utf8') > 240)
    fail(
      'path_safety',
      'FILENAME_COMPONENT_LIMIT',
      'Canonical document filename exceeds the portable component limit.',
    );
  return filename;
}

/** Encodes stable field order, JSON-flow metadata, LF, and one matching H1. */
export function encodeCanonicalDocument(
  metadata: CanonicalDocumentMetadata,
  content: string,
  limits: DesignDocsLimits,
): Uint8Array {
  validateMetadata(metadata, limits);
  const body = canonicalDocumentBody(metadata.title, content);
  validateBody(metadata.title, body, limits);
  const source = [
    '---',
    `id: ${JSON.stringify(metadata.id)}`,
    `title: ${JSON.stringify(metadata.title)}`,
    `kind: ${metadata.kind}`,
    `status: ${metadata.status}`,
    `version: ${metadata.version}`,
    `created_at: ${JSON.stringify(metadata.created_at)}`,
    `updated_at: ${JSON.stringify(metadata.updated_at)}`,
    ...(metadata.created_by === undefined ? [] : [`created_by: ${JSON.stringify(metadata.created_by)}`]),
    ...(metadata.metadata === undefined ? [] : [`metadata: ${JSON.stringify(sortJson(metadata.metadata))}`]),
    '---',
    '',
    body,
  ].join('\n');
  const bytes = encoder.encode(source.endsWith('\n') ? source : `${source}\n`);
  if (bytes.byteLength > limits.max_file_bytes) limit('DOCUMENT_FILE_LIMIT', 'Document file byte limit exceeded.');
  return bytes;
}

/** Strictly decodes Neottia's canonical UTF-8 Markdown representation. */
export function decodeDocument(source: string | Uint8Array, limits: DesignDocsLimits): DecodedDocument {
  return decodeSource(source, limits, false);
}

/** Decodes exact harnessctl-v2 bytes, then canonicalizes the semantic record for Neottia. */
export function decodeHarnessctlDocument(source: string | Uint8Array, limits: DesignDocsLimits): DecodedDocument {
  return decodeSource(source, limits, true);
}

function decodeSource(source: string | Uint8Array, limits: DesignDocsLimits, harnessctlV2: boolean): DecodedDocument {
  const bytes = typeof source === 'string' ? encoder.encode(source) : Uint8Array.from(source);
  if (bytes.byteLength > limits.max_file_bytes) limit('DOCUMENT_FILE_LIMIT', 'Document file byte limit exceeded.');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    fail('parse_safety', 'UTF8_BOM', 'UTF-8 byte-order marks are not permitted.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('parse_safety', 'UTF8_INVALID', 'Document must be valid UTF-8.');
  }
  if (text.includes('\r')) fail('canonical_form', 'LINE_ENDINGS_INVALID', 'Document must use LF line endings.');
  assertUnicode(text, 'document source');
  const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/u.exec(text);
  if (!match) fail('parse_safety', 'FRONTMATTER_INVALID', 'Document must contain strict YAML frontmatter.');
  const frontmatter = match[1] as string;
  if (encoder.encode(frontmatter).byteLength > limits.max_frontmatter_bytes)
    limit('FRONTMATTER_LIMIT', 'Document frontmatter byte limit exceeded.');
  if (frontmatter.trimStart().startsWith('%'))
    fail('parse_safety', 'YAML_DIRECTIVE', 'YAML directives are not permitted.');
  const yaml = parseDocument(frontmatter, { uniqueKeys: true, strict: true });
  if (yaml.errors.length || yaml.warnings.length)
    fail('parse_safety', 'YAML_AMBIGUOUS', 'Document frontmatter is malformed or ambiguous.');
  const state = { nodes: 0, keys: 0 };
  const value = yamlValue(yaml.contents as Node | null, 0, state, false, limits);
  if (!isRecord(value)) fail('schema', 'FRONTMATTER_SCHEMA', 'Document frontmatter must be a mapping.');
  for (const key of Object.keys(value))
    if (!ALLOWED_KEYS.has(key)) fail('schema', 'FIELD_UNSUPPORTED', `Unsupported document field: ${key}`);
  const parsed = documentMetadataSchema.safeParse(value);
  if (!parsed.success)
    fail(
      'schema',
      'METADATA_INVALID',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  const metadata = parsed.data;
  validateMetadata(metadata, limits);
  const body = match[2] as string;
  validateBody(metadata.title, body, limits, harnessctlV2);
  const content = body.slice(`# ${metadata.title}\n\n`.length).trimEnd();
  const sourceCanonical = harnessctlV2
    ? encodeHarnessctlDocument(metadata, content, limits)
    : encodeCanonicalDocument(metadata, content, limits);
  if (!Buffer.from(sourceCanonical).equals(Buffer.from(bytes)))
    fail('canonical_form', 'CANONICAL_BYTES_INVALID', 'Document is not in canonical form.');
  // Imports publish Neottia bytes so legacy presentation never becomes a second authority.
  const canonical = harnessctlV2 ? encodeCanonicalDocument(metadata, content, limits) : bytes;
  const repositoryRevision = computeByteRevision(canonical);
  return {
    metadata,
    body: canonicalDocumentBody(metadata.title, content),
    content,
    bytes: canonical,
    revision: `v1:${repositoryRevision.slice('sha256:'.length)}`,
  };
}

export function canonicalDocumentBody(title: string, content: string): string {
  assertUnicode(content, 'document content');
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  if (normalized.split('\n').some((line) => /^#(?:\s|$)/u.test(line)))
    fail('canonical_form', 'H1_ADDITIONAL', 'Document content must not contain a level-one heading.');
  return `# ${title}\n\n${normalized}`;
}

function validateBody(title: string, body: string, limits: DesignDocsLimits, allowLegacySetext = false): void {
  assertUnicode(body, 'document body');
  // Markdown authority excludes control bytes which can disguise headings or delimiters.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(body))
    fail('parse_safety', 'BODY_CONTROL_CHARACTER', 'Document body contains unsupported control characters.');
  if (encoder.encode(body).byteLength > limits.max_body_bytes)
    limit('BODY_LIMIT', 'Document body byte limit exceeded.');
  const lines = body.replace(/\n$/u, '').split('\n');
  if (lines[0] !== `# ${title}` || lines[1] !== '')
    fail('canonical_form', 'H1_INVALID', 'Document body must begin with one matching H1 followed by a blank line.');
  if (
    lines.slice(2).some((line) => /^#(?:\s|$)/u.test(line)) ||
    (!allowLegacySetext && containsSetextH1(lines.slice(2)))
  )
    fail('canonical_form', 'H1_ADDITIONAL', 'Additional level-one headings are not allowed.');
}

function encodeHarnessctlDocument(
  metadata: CanonicalDocumentMetadata,
  content: string,
  limits: DesignDocsLimits,
): Uint8Array {
  validateMetadata(metadata, limits);
  const body = canonicalDocumentBody(metadata.title, content);
  validateBody(metadata.title, body, limits, true);
  const source = [
    '---',
    `id: ${JSON.stringify(metadata.id)}`,
    `title: ${JSON.stringify(metadata.title)}`,
    `kind: ${metadata.kind}`,
    `status: ${metadata.status}`,
    `version: ${metadata.version}`,
    `created_at: ${JSON.stringify(metadata.created_at)}`,
    `updated_at: ${JSON.stringify(metadata.updated_at)}`,
    ...(metadata.created_by === undefined ? [] : [`created_by: ${JSON.stringify(metadata.created_by)}`]),
    ...(metadata.metadata === undefined ? [] : [`metadata: ${JSON.stringify(metadata.metadata)}`]),
    '---',
    '',
    body,
  ].join('\n');
  const bytes = encoder.encode(source.endsWith('\n') ? source : `${source}\n`);
  if (bytes.byteLength > limits.max_file_bytes) limit('DOCUMENT_FILE_LIMIT', 'Document file byte limit exceeded.');
  return bytes;
}

function validateMetadata(metadata: CanonicalDocumentMetadata, limits: DesignDocsLimits): void {
  const parsed = documentMetadataSchema.safeParse(metadata);
  if (!parsed.success) fail('schema', 'METADATA_INVALID', parsed.error.issues.map((issue) => issue.message).join('; '));
  assertDocumentId(metadata.id);
  assertUnicode(metadata.title, 'title');
  if (metadata.metadata !== undefined) {
    validateJson(metadata.metadata, 0, { nodes: 0, keys: 0 }, new Set(), limits);
    if (encoder.encode(JSON.stringify(metadata.metadata)).byteLength > limits.max_metadata_bytes)
      limit('METADATA_LIMIT', 'Document metadata byte limit exceeded.');
  }
}

type SafeValue = string | number | boolean | null | SafeValue[] | { [key: string]: SafeValue };
function yamlValue(
  node: Node | null,
  depth: number,
  state: { nodes: number; keys: number },
  metadata: boolean,
  limits: DesignDocsLimits,
): SafeValue {
  if (!node) fail('schema', 'YAML_NODE_MISSING', 'YAML node is missing.');
  if (depth > limits.max_yaml_depth) limit('YAML_DEPTH_LIMIT', 'YAML depth limit exceeded.');
  if (++state.nodes > limits.max_yaml_nodes) limit('YAML_NODE_LIMIT', 'YAML node limit exceeded.');
  if (isAlias(node)) fail('parse_safety', 'YAML_ALIAS', 'YAML aliases are not permitted.');
  if ('anchor' in node && node.anchor) fail('parse_safety', 'YAML_ANCHOR', 'YAML anchors are not permitted.');
  if (node.tag) fail('parse_safety', 'YAML_TAG', 'Explicit YAML tags are not permitted.');
  if (isScalar(node)) return scalar(node);
  if (isSeq(node)) return node.items.map((item) => yamlValue(item as Node | null, depth + 1, state, metadata, limits));
  if (!isMap(node)) fail('schema', 'YAML_NODE_UNSUPPORTED', 'Unsupported YAML node.');
  const output: Record<string, SafeValue> = Object.create(null) as Record<string, SafeValue>;
  const compared = new Set<string>();
  for (const pair of node.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string')
      fail('parse_safety', 'YAML_KEY_INVALID', 'YAML mapping keys must be strings.');
    const key = pair.key.value;
    const comparison = portableKey(key);
    if (!key.trim() || key !== key.trim() || compared.has(comparison))
      fail('schema', 'YAML_KEY_COLLISION', 'YAML mapping keys are blank or collide under portable comparison.');
    compared.add(comparison);
    if (metadata && ++state.keys > limits.max_metadata_keys)
      limit('METADATA_KEY_LIMIT', 'Metadata key limit exceeded.');
    output[key] = yamlValue(pair.value as Node | null, depth + 1, state, metadata || key === 'metadata', limits);
  }
  return output;
}

function scalar(node: Scalar): SafeValue {
  if (typeof node.value === 'number') {
    if (!Number.isFinite(node.value)) fail('parse_safety', 'YAML_NUMBER_INVALID', 'Only finite numbers are permitted.');
    return Object.is(node.value, -0) ? 0 : node.value;
  }
  if (typeof node.value === 'bigint') {
    const number = Number(node.value);
    if (!Number.isSafeInteger(number))
      fail('parse_safety', 'YAML_NUMBER_INVALID', 'Only safe finite numbers are permitted.');
    return number;
  }
  if (typeof node.value === 'string') assertUnicode(node.value, 'YAML scalar');
  if (typeof node.value === 'string' || typeof node.value === 'boolean' || node.value === null) return node.value;
  fail('parse_safety', 'YAML_SCALAR_INVALID', 'Unsupported YAML scalar.');
}

function validateJson(
  value: unknown,
  depth: number,
  state: { nodes: number; keys: number },
  seen: Set<object>,
  limits: DesignDocsLimits,
): void {
  if (depth > limits.max_yaml_depth) limit('METADATA_DEPTH_LIMIT', 'Metadata depth limit exceeded.');
  if (++state.nodes > limits.max_yaml_nodes) limit('METADATA_NODE_LIMIT', 'Metadata node limit exceeded.');
  if (typeof value === 'string') {
    assertUnicode(value, 'metadata scalar');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('schema', 'METADATA_NUMBER_INVALID', 'Metadata numbers must be finite.');
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value !== 'object') fail('schema', 'METADATA_VALUE_INVALID', 'Metadata must contain JSON values.');
  if (seen.has(value)) fail('schema', 'METADATA_CYCLE', 'Metadata must not contain cycles.');
  seen.add(value);
  if (Array.isArray(value)) for (const item of value) validateJson(item, depth + 1, state, seen, limits);
  else {
    const keys = new Set<string>();
    for (const [key, item] of Object.entries(value)) {
      if (++state.keys > limits.max_metadata_keys) limit('METADATA_KEY_LIMIT', 'Metadata key limit exceeded.');
      const portable = portableKey(key);
      if (!key.trim() || key !== key.trim() || keys.has(portable))
        fail('schema', 'METADATA_KEY_INVALID', 'Metadata keys are blank or collide.');
      keys.add(portable);
      validateJson(item, depth + 1, state, seen, limits);
    }
  }
  seen.delete(value);
}

function containsSetextH1(lines: readonly string[]): boolean {
  let fence: '`' | '~' | undefined;
  let fenceLength = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string;
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      const kind = marker[0] as '`' | '~';
      if (fence === undefined) {
        fence = kind;
        fenceLength = marker.length;
      } else if (fence === kind && marker.length >= fenceLength) {
        fence = undefined;
        fenceLength = 0;
      }
      continue;
    }
    if (fence !== undefined || !/^ {0,3}=+\s*$/u.test(line) || index === 0) continue;
    const previous = lines[index - 1] as string;
    if (previous.trim() && !/^ {4}|\t/u.test(previous)) return true;
  }
  return false;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function slug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 80)
      .replace(/-+$/u, '') || 'document'
  );
}
function portableKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function assertUnicode(value: string, label: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (next < 0xdc00 || next > 0xdfff) fail('parse_safety', 'UNICODE_INVALID', `${label} contains invalid Unicode.`);
    } else if (code >= 0xdc00 && code <= 0xdfff)
      fail('parse_safety', 'UNICODE_INVALID', `${label} contains invalid Unicode.`);
  }
}
function limit(code: string, message: string): never {
  throw new DesignDocsError('resource_limit', code, message);
}
function fail(category: ConstructorParameters<typeof DesignDocsError>[0], code: string, message: string): never {
  throw new DesignDocsError(category, code, message);
}
