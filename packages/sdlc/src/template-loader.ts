import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, checksumText, compareCodeUnits, type TemplateLayer } from '@neottia/distribution';

import {
  SDLC_COMMAND_IDS,
  SDLC_CONTENT_TEMPLATE_ID,
  SDLC_LAYOUT_TEMPLATE_ID,
  SDLC_LIFECYCLE_VERSION,
} from './lifecycle.js';

/** Default byte limit for one packaged or override template directory. */
export const SDLC_TEMPLATE_LAYER_MAX_BYTES = 1024 * 1024;

const TEMPLATE_DIRECTORY_SEGMENTS = ['.neottia', 'templates', 'sdlc'] as const;
const COMMAND_TEMPLATE_FILENAMES = new Map<string, string>(
  SDLC_COMMAND_IDS.map((command) => [`${command}.md.twig`, `neottia.sdlc.command.${command}`]),
);
const PACKAGED_TEMPLATE_FILENAMES = new Map<string, string>([
  ...COMMAND_TEMPLATE_FILENAMES,
  ['layout.md.twig', SDLC_LAYOUT_TEMPLATE_ID],
  ['lifecycle.json', SDLC_CONTENT_TEMPLATE_ID],
]);

/** Filesystem locations and package layers used before pure compilation. */
export interface LoadSdlcTemplateLayersOptions {
  /** Home or equivalent root containing `.neottia/templates/sdlc`. */
  readonly globalRoot?: string;
  /** Project root containing `.neottia/templates/sdlc`. */
  readonly projectRoot?: string;
  /** Explicit package-owned layers between packaged and user overrides. */
  readonly packageLayers?: readonly TemplateLayer[];
  /** Maximum bytes read from each template directory. */
  readonly maxBytes?: number;
}

/** Loads packaged templates and conventional overrides outside the pure compiler. */
export async function loadSdlcTemplateLayers(
  options: LoadSdlcTemplateLayersOptions = {},
): Promise<readonly TemplateLayer[]> {
  const maxBytes = options.maxBytes ?? SDLC_TEMPLATE_LAYER_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('SDLC template byte limit is invalid.');
  validateOptionalRoot(options.globalRoot, 'Global');
  validateOptionalRoot(options.projectRoot, 'Project');
  for (const layer of options.packageLayers ?? []) {
    if (layer.tier !== 'package') throw new TypeError('SDLC package template layers must use the package tier.');
  }

  const layers: TemplateLayer[] = [await loadPackagedSdlcTemplateLayer(maxBytes), ...(options.packageLayers ?? [])];
  if (options.globalRoot !== undefined) {
    const global = await loadOverrideLayer(options.globalRoot, 'global', maxBytes);
    if (global !== undefined) layers.push(global);
  }
  if (options.projectRoot !== undefined) {
    const project = await loadOverrideLayer(options.projectRoot, 'project', maxBytes);
    if (project !== undefined) layers.push(project);
  }
  return Object.freeze([...layers]);
}

/** Loads command templates, shared layout, and lifecycle prose from the SDLC package. */
export async function loadPackagedSdlcTemplateLayer(maxBytes = SDLC_TEMPLATE_LAYER_MAX_BYTES): Promise<TemplateLayer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('SDLC template byte limit is invalid.');
  const directory = fileURLToPath(new URL('../templates/', import.meta.url));
  const files = await loadTemplateDirectory(
    directory,
    maxBytes,
    PACKAGED_TEMPLATE_FILENAMES,
    SDLC_COMMAND_IDS.length + 2,
  );
  return freezeLayer({
    tier: 'packaged',
    sourceId: '@neottia/sdlc',
    version: SDLC_LIFECYCLE_VERSION,
    files,
  });
}

/** Loads one conventional global or project override directory. */
async function loadOverrideLayer(
  root: string,
  tier: 'global' | 'project',
  maxBytes: number,
): Promise<TemplateLayer | undefined> {
  const directory = await conventionalTemplateDirectory(root);
  if (directory === undefined) return undefined;
  const files = await loadTemplateDirectory(directory, maxBytes, COMMAND_TEMPLATE_FILENAMES);
  if (files.length === 0) return undefined;
  return freezeLayer({
    tier,
    sourceId: `neottia-${tier}-sdlc`,
    version: checksumText(canonicalJson(files)),
    files,
  });
}

/** Resolves the fixed override path while rejecting linked ancestors. */
async function conventionalTemplateDirectory(root: string): Promise<string | undefined> {
  let current = root;
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new TypeError('SDLC template root must be a regular directory.');
  }
  for (const segment of TEMPLATE_DIRECTORY_SEGMENTS) {
    current = join(current, segment);
    const stat = await optionalLstat(current);
    if (stat === undefined) return undefined;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new TypeError('SDLC template path must contain only regular directories.');
    }
  }
  return current;
}

/** Reads a bounded directory and rejects every unknown command filename. */
async function loadTemplateDirectory(
  directory: string,
  maxBytes: number,
  filenames: ReadonlyMap<string, string>,
  expectedCount?: number,
): Promise<readonly { readonly id: string; readonly content: string }[]> {
  const directoryStat = await lstat(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new TypeError('SDLC template directory must be a regular directory.');
  }
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    compareCodeUnits(left.name, right.name),
  );
  const files: Array<{ id: string; content: string }> = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const templateId = filenames.get(entry.name);
    if (templateId === undefined) throw new TypeError(`Unknown SDLC template filename ${entry.name}.`);
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    if (!entry.isFile() || stat.isSymbolicLink() || !stat.isFile()) {
      throw new TypeError(`SDLC template ${entry.name} must be a regular file.`);
    }
    totalBytes += stat.size;
    if (totalBytes > maxBytes) throw new TypeError('SDLC template source exceeds its configured byte limit.');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
    if (content.includes('\0') || content.includes('\r')) {
      throw new TypeError(`SDLC template ${entry.name} must use LF text without NUL bytes.`);
    }
    files.push({ id: templateId, content });
  }
  if (expectedCount !== undefined && files.length !== expectedCount) {
    throw new TypeError('Published SDLC templates are incomplete.');
  }
  return Object.freeze(files.map((file) => Object.freeze(file)));
}

/** Reads one optional path without hiding filesystem failures. */
async function optionalLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Rejects relative roots before any filesystem access. */
function validateOptionalRoot(root: string | undefined, label: string): void {
  if (root !== undefined && !isAbsolute(root)) throw new TypeError(`${label} SDLC template root must be absolute.`);
}

/** Freezes detached layers before compilation receives them. */
function freezeLayer(layer: TemplateLayer): TemplateLayer {
  return Object.freeze({
    ...layer,
    files: Object.freeze(layer.files.map((file) => Object.freeze({ ...file }))),
  });
}
