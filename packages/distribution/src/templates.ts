import { lstat, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { checksumText } from './manifest.js';
import type { LoadTemplateLayerOptions, ResolvedTemplate, TemplateLayer, TemplateTier } from './types.js';

/** Fixed precedence makes input enumeration order irrelevant. */
const TIER_ORDER: Readonly<Record<TemplateTier, number>> = Object.freeze({
  packaged: 0,
  package: 1,
  global: 2,
  project: 3,
});
const TEMPLATE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

/** Loads one explicit template manifest and verifies every referenced file. */
export async function loadTemplateLayer(options: LoadTemplateLayerOptions): Promise<TemplateLayer> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  if (!isAbsolute(options.manifestPath) || maxBytes < 1) throw new TypeError('Template manifest options are invalid.');
  const manifestStat = await lstat(options.manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > maxBytes) {
    throw new TypeError('Template manifest must be a bounded regular file.');
  }
  const document = JSON.parse(await readFile(options.manifestPath, 'utf8')) as {
    readonly schemaVersion?: unknown;
    readonly templates?: unknown;
  };
  if (document.schemaVersion !== 1 || !plainRecord(document.templates)) {
    throw new TypeError('Template manifest schema is invalid.');
  }
  const root = dirname(options.manifestPath);
  const files: Array<{ id: string; content: string }> = [];
  let totalBytes = manifestStat.size;
  for (const [id, declaration] of Object.entries(document.templates).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!TEMPLATE_ID.test(id) || !plainRecord(declaration)) throw new TypeError('Template declaration is invalid.');
    const file = declaration.file;
    const declaredChecksum = declaration.checksum;
    if (typeof file !== 'string' || typeof declaredChecksum !== 'string')
      throw new TypeError('Template declaration is incomplete.');
    const path = resolve(root, file);
    const relation = relative(root, path);
    if (relation.startsWith('..') || isAbsolute(relation))
      throw new TypeError('Template file escapes its manifest directory.');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError('Template source must be a regular file.');
    totalBytes += stat.size;
    if (totalBytes > maxBytes) throw new TypeError('Template source exceeds its configured byte limit.');
    const content = await readFile(path, 'utf8');
    if (checksumText(content) !== declaredChecksum) throw new TypeError(`Template ${id} checksum does not match.`);
    files.push({ id, content });
  }
  const layer: TemplateLayer = {
    tier: options.tier,
    sourceId: options.sourceId,
    version: options.version,
    files,
  };
  validateLayers([layer]);
  return Object.freeze({ ...layer, files: Object.freeze(files.map((file) => Object.freeze(file))) });
}

/** Resolves complete template files at four explicit precedence tiers. */
export function resolveTemplates(
  requiredIds: readonly string[],
  layers: readonly TemplateLayer[],
): readonly ResolvedTemplate[] {
  const required = [...new Set(requiredIds)].sort((left, right) => left.localeCompare(right));
  if (required.some((id) => !TEMPLATE_ID.test(id))) throw new TypeError('Required template ID is invalid.');
  validateLayers(layers);

  const candidates = new Map<
    string,
    Array<{ tier: TemplateTier; sourceId: string; version: string; content: string }>
  >();
  for (const layer of layers) {
    for (const file of layer.files) {
      const list = candidates.get(file.id) ?? [];
      list.push({ tier: layer.tier, sourceId: layer.sourceId, version: layer.version, content: file.content });
      candidates.set(file.id, list);
    }
  }

  return Object.freeze(
    required.map((id) => {
      const matches = candidates.get(id);
      if (matches === undefined || matches.length === 0) throw new TypeError(`Required template ${id} is missing.`);
      const ordered = [...matches].sort(
        (left, right) => TIER_ORDER[left.tier] - TIER_ORDER[right.tier] || left.sourceId.localeCompare(right.sourceId),
      );
      const winner = ordered.at(-1)!;
      return Object.freeze({
        id,
        content: winner.content,
        checksum: checksumText(winner.content),
        sourceId: winner.sourceId,
        version: winner.version,
        shadowed: Object.freeze(
          ordered.slice(0, -1).map((candidate) =>
            Object.freeze({
              sourceId: candidate.sourceId,
              version: candidate.version,
              checksum: checksumText(candidate.content),
            }),
          ),
        ),
      });
    }),
  );
}

/** Rejects ambiguous sources and invalid generated text. */
function validateLayers(layers: readonly TemplateLayer[]): void {
  if (!Array.isArray(layers)) throw new TypeError('Template layers must be an array.');
  const idsByTier = new Map<TemplateTier, Set<string>>();
  for (const layer of layers) {
    if (!Object.hasOwn(TIER_ORDER, layer.tier)) throw new TypeError('Template tier is invalid.');
    if (!nonblank(layer.sourceId) || !nonblank(layer.version))
      throw new TypeError('Template source metadata is required.');
    if (!Array.isArray(layer.files)) throw new TypeError('Template files must be an array.');
    const tierIds = idsByTier.get(layer.tier) ?? new Set<string>();
    const sourceIds = new Set<string>();
    for (const file of layer.files) {
      if (!TEMPLATE_ID.test(file.id)) throw new TypeError('Template ID is invalid.');
      if (tierIds.has(file.id) || sourceIds.has(file.id)) {
        throw new TypeError(`Template ${file.id} is duplicated within the ${layer.tier} tier.`);
      }
      if (typeof file.content !== 'string' || file.content.includes('\0') || file.content.includes('\r')) {
        throw new TypeError('Template content must use LF text without NUL bytes.');
      }
      tierIds.add(file.id);
      sourceIds.add(file.id);
    }
    idsByTier.set(layer.tier, tierIds);
  }
}

/** Checks JSON objects without accepting arrays. */
function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Checks required strings without rewriting caller data. */
function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
