import type { HostConfigOperation } from '@neottia/harness-adapter';

import { applyEdits, modify, parse, type FormattingOptions, type ParseError } from 'jsonc-parser';

import { canonicalJson, checksumText } from './manifest.js';
import type { JsonValue, OwnedUnit, UnitState } from './types.js';

/** Stable formatting used only for inserted or replaced JSONC values. */
const FORMATTING: FormattingOptions = Object.freeze({ insertSpaces: true, tabSize: 2, eol: '\n' });

/** Converts an adapter operation to its receipt ownership unit. */
export function operationUnit(operation: HostConfigOperation): OwnedUnit {
  return operation.kind === 'ensure-array-entry'
    ? Object.freeze({ kind: 'array-entry' as const, pointer: operation.pointer, identity: operation.identity })
    : Object.freeze({ kind: 'object-entry' as const, pointer: operation.pointer, key: operation.key });
}

/** Returns the exact desired value of an adapter operation. */
export function operationState(operation: HostConfigOperation): UnitState & { readonly exists: true } {
  const value = operation.kind === 'ensure-array-entry' ? operation.value : operation.value;
  const content = canonicalJson(value);
  return Object.freeze({ exists: true as const, checksum: checksumText(content), encoding: 'json' as const, content });
}

/** Reads one entry-level ownership unit from JSON or JSONC content. */
export function readHostUnit(content: string | undefined, unit: OwnedUnit): UnitState {
  if (unit.kind === 'file') throw new TypeError('A file unit cannot be read from host configuration.');
  if (content === undefined) return Object.freeze({ exists: false });
  const document = parseDocument(content);
  const parent = valueAt(document, decodePointer(unit.pointer));
  let value: unknown;
  if (unit.kind === 'array-entry') {
    if (parent === undefined) return Object.freeze({ exists: false });
    if (!Array.isArray(parent)) throw new TypeError(`Host configuration pointer ${unit.pointer} is not an array.`);
    value = parent.find((candidate) => arrayEntryIdentity(candidate) === unit.identity);
  } else {
    if (parent === undefined) return Object.freeze({ exists: false });
    if (!plainRecord(parent)) throw new TypeError(`Host configuration pointer ${unit.pointer} is not an object.`);
    value = parent[unit.key];
  }
  if (value === undefined) return Object.freeze({ exists: false });
  const serialized = canonicalJson(value);
  return Object.freeze({ exists: true, checksum: checksumText(serialized), encoding: 'json', content: serialized });
}

/** Applies entry-level states while preserving unrelated JSONC bytes and comments. */
export function applyHostUnitStates(
  currentContent: string | undefined,
  changes: readonly { readonly unit: OwnedUnit; readonly state: UnitState }[],
): string {
  let content = currentContent ?? '{}\n';
  parseDocument(content);
  for (const change of changes) {
    if (change.unit.kind === 'file') throw new TypeError('A file unit cannot edit host configuration.');
    const pointer = decodePointer(change.unit.pointer);
    const document = parseDocument(content);
    if (change.unit.kind === 'array-entry') {
      const parent = valueAt(document, pointer);
      if (parent !== undefined && !Array.isArray(parent)) {
        throw new TypeError(`Host configuration pointer ${change.unit.pointer} is not an array.`);
      }
      const values = parent === undefined ? [] : [...parent];
      const identity = change.unit.identity;
      const index = values.findIndex((candidate) => arrayEntryIdentity(candidate) === identity);
      if (change.state.exists) {
        const value = parseUnitValue(change.state);
        if (index === -1) values.push(value);
        else values[index] = value;
      } else if (index !== -1) {
        values.splice(index, 1);
      }
      const changed = parent === undefined ? values.length > 0 : canonicalJson(values) !== canonicalJson(parent);
      if (changed) content = replaceValue(content, pointer, values);
    } else {
      const parent = valueAt(document, pointer);
      if (parent !== undefined && !plainRecord(parent)) {
        throw new TypeError(`Host configuration pointer ${change.unit.pointer} is not an object.`);
      }
      const path = [...pointer, change.unit.key];
      if (change.state.exists) {
        const value = parseUnitValue(change.state);
        if (parent === undefined || canonicalJson(parent[change.unit.key]) !== canonicalJson(value)) {
          content = replaceValue(content, path, value);
        }
      } else if (parent !== undefined && Object.hasOwn(parent, change.unit.key)) {
        content = replaceValue(content, path, undefined);
      }
    }
  }
  return content.endsWith('\n') ? content : `${content}\n`;
}

/** Parses canonical receipt content back into a JSON-compatible value. */
function parseUnitValue(state: UnitState): JsonValue {
  if (!state.exists || state.encoding !== 'json' || state.content === undefined) {
    throw new TypeError('Host configuration state is not a JSON value.');
  }
  return JSON.parse(state.content) as JsonValue;
}

/** Uses structured edits rather than rewriting the complete document. */
function replaceValue(content: string, path: readonly (string | number)[], value: unknown): string {
  return applyEdits(content, modify(content, [...path], value, { formattingOptions: FORMATTING }));
}

/** Parses JSONC and rejects malformed or non-object roots. */
function parseDocument(content: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const document = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0 || !plainRecord(document)) throw new TypeError('Host configuration must be a JSON object.');
  return document;
}

/** Reads one decoded path without changing the document. */
function valueAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!plainRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Decodes RFC 6901 pointer segments. */
function decodePointer(pointer: string): readonly string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new TypeError('Host configuration pointer is invalid.');
  return Object.freeze(
    pointer
      .slice(1)
      .split('/')
      .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~')),
  );
}

/** Derives adapter package identity from current host array values. */
function arrayEntryIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.startsWith('npm:') ? value.slice(4) : value;
  const separator = normalized.lastIndexOf('@');
  const scopedBoundary = normalized.startsWith('@') ? normalized.indexOf('/') : 0;
  const packageName = separator > scopedBoundary ? normalized.slice(0, separator) : normalized;
  return packageName.length > 0 ? `npm:${packageName}` : undefined;
}

/** Checks JSON object values without accepting arrays. */
function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
