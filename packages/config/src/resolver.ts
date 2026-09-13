import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { homedir as systemHomedir } from 'node:os';
import path from 'node:path';
import { isMap, isSeq, parseDocument, type Node } from 'yaml';
import {
  CONFIG_ROOT_SECTIONS,
  type ConfigDiagnostic,
  type ConfigProvenance,
  type ConfigRegistry,
  type ResolvedConfigSnapshot,
  type UnknownConfigContribution,
} from './contracts.js';
import { getRegistryState } from './registry.js';
import { createResolvedConfigSnapshotWithMetadata } from './snapshot.js';

/** The maximum number of diagnostics retained by one failed resolution. */
export const MAX_CONFIG_DIAGNOSTICS = 50;
/** Maximum UTF-8 bytes accepted from one configuration file. */
export const MAX_CONFIG_FILE_BYTES = 1024 * 1024;
/** Maximum nested YAML collection depth accepted before value conversion. */
export const MAX_CONFIG_YAML_DEPTH = 64;
/** Maximum YAML scalar and collection nodes accepted before value conversion. */
export const MAX_CONFIG_YAML_NODES = 10_000;

/** Inputs whose explicit values remain isolated from ambient process state. */
export interface ResolveConfigOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly profile?: string;
  readonly globalFile?: string | false;
  readonly projectFile?: string | false;
  readonly overrides?: Readonly<Record<string, unknown>>;
  /** Narrow legacy behaviors used only by deprecated domain compatibility wrappers. */
  readonly compatibility?: {
    readonly ignoreUnregisteredPaths?: boolean;
    readonly resolveOverrideSecretReferences?: boolean;
  };
}

/** Injectable inputs for deterministic platform-specific global path discovery. */
export interface DefaultGlobalConfigPathOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homedir?: string;
  readonly platform?: NodeJS.Platform;
}

/** Reports bounded resolution diagnostics without embedding rejected values. */
export class ConfigResolutionError extends Error {
  readonly code = 'CONFIG_RESOLUTION_FAILED';
  readonly diagnostics: readonly ConfigDiagnostic[];

  constructor(diagnostics: readonly ConfigDiagnostic[]) {
    const frozen = freezeDiagnostics(diagnostics);
    super(`Configuration resolution failed with ${frozen.length} diagnostic${frozen.length === 1 ? '' : 's'}`);
    this.name = 'ConfigResolutionError';
    this.diagnostics = frozen;
  }
}

interface MutableDiagnosticCollector {
  readonly diagnostics: ConfigDiagnostic[];
  omitted: number;
}

interface LocatedShard {
  readonly actualPath: readonly string[];
  readonly legacyPath?: readonly string[];
  readonly patch: unknown;
}

interface ValidatedFragment {
  readonly shards: ReadonlyMap<string, LocatedShard>;
}

interface LoadedDocument {
  readonly base: ValidatedFragment;
  readonly file: string;
  readonly kind: 'global' | 'project';
  readonly profiles: ReadonlyMap<string, ValidatedFragment>;
}

interface SourceSelection {
  readonly explicit: boolean;
  readonly file: string;
  readonly kind: 'global' | 'project';
}

interface MutableResolution {
  readonly provenance: Map<string, ConfigProvenance>;
  value: unknown;
}

const ENVIRONMENT_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u;

/** Resolves all registered shards through the fixed configuration precedence contract. */
export function resolveConfig(registry: ConfigRegistry, options: ResolveConfigOptions): ResolvedConfigSnapshot {
  if (getRegistryState(registry) === undefined) {
    throw new ConfigResolutionError([
      { code: 'PATH', message: 'configuration registry was not created by @neottia/config' },
    ]);
  }
  if (typeof options.cwd !== 'string' || options.cwd.length === 0) {
    throw new ConfigResolutionError([{ code: 'PATH', message: 'configuration cwd must be a non-empty path' }]);
  }

  const cwd = path.resolve(options.cwd);
  const env = options.env ?? process.env;
  const collector = createCollector();
  const selections = selectFiles(options, cwd, env);
  const parsedFiles = new Map<string, unknown>();
  const documents: LoadedDocument[] = [];
  for (const selection of selections) {
    const loaded = loadDocument(
      registry,
      selection,
      parsedFiles,
      collector,
      options.compatibility?.ignoreUnregisteredPaths ?? false,
    );
    if (loaded !== undefined) documents.push(loaded);
  }

  const profile = selectProfile(options.profile, env, collector);
  if (profile !== undefined && !documents.some((document) => document.profiles.has(profile))) {
    addDiagnostic(collector, {
      code: 'PROFILE',
      message: 'selected profile is not declared by any loaded configuration file',
      path: ['profiles', profile],
    });
  }

  const resolutions = initializeDefaults(registry);
  for (const document of documents) {
    applyFragment(resolutions, document.base, {
      file: document.file,
      kind: document.kind,
    });
  }
  if (profile !== undefined) {
    for (const document of documents) {
      const fragment = document.profiles.get(profile);
      if (fragment !== undefined) {
        applyFragment(resolutions, fragment, {
          file: document.file,
          kind: 'profile',
          profile,
        });
      }
    }
  }

  applyEnvironment(registry, resolutions, env, collector);
  if (options.overrides !== undefined) {
    const source: ConfigProvenance = { kind: 'override', label: 'explicit overrides' };
    const overrides = validateFragment(
      registry,
      options.overrides,
      source,
      'runtime',
      collector,
      [],
      options.compatibility?.ignoreUnregisteredPaths ?? false,
    );
    if (overrides !== undefined) applyFragment(resolutions, overrides, source);
  }
  resolveSecrets(
    registry,
    resolutions,
    env,
    collector,
    options.compatibility?.resolveOverrideSecretReferences ?? false,
  );

  const values: Record<string, unknown> = {};
  for (const contribution of registry.contributions) {
    const resolution = resolutions.get(contribution.id);
    if (resolution === undefined) continue;
    const result = contribution.resolvedSchema.safeParse(resolution.value);
    if (!result.success) {
      addSchemaDiagnostics(collector, contribution, contribution.path, result.error.issues, {
        kind: 'override',
        label: 'resolved configuration',
      });
      continue;
    }
    values[contribution.id] = result.data;
  }

  throwIfDiagnostics(collector);
  return createResolvedConfigSnapshotWithMetadata(registry, values, {
    diagnostics: [],
    provenance: serializeProvenance(resolutions),
    validatedShards: true,
  });
}

/** Returns the default global file using the conventions of the target platform. */
export function getDefaultGlobalConfigPath(options: DefaultGlobalConfigPathOptions = {}): string {
  const env = options.env ?? process.env;
  const home = options.homedir ?? systemHomedir();
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    const applicationData = populated(env.APPDATA) ?? path.win32.join(home, 'AppData', 'Roaming');
    return path.win32.join(applicationData, 'neottia', 'config.yml');
  }
  const xdg = populated(env.XDG_CONFIG_HOME);
  if (xdg !== undefined) return path.posix.join(xdg, 'neottia', 'config.yml');
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', 'neottia', 'config.yml');
  }
  return path.posix.join(home, '.config', 'neottia', 'config.yml');
}

/** Computes explicit and optional default file selections. */
function selectFiles(
  options: ResolveConfigOptions,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): SourceSelection[] {
  const selections: SourceSelection[] = [];
  const globalOverride = options.globalFile === undefined ? populated(env.NEOTTIA_GLOBAL_CONFIG_FILE) : undefined;
  if (options.globalFile !== false) {
    const configured = typeof options.globalFile === 'string' ? options.globalFile : globalOverride;
    selections.push({
      explicit: configured !== undefined,
      file: configured === undefined ? getDefaultGlobalConfigPath({ env }) : resolveFrom(cwd, configured),
      kind: 'global',
    });
  }

  const projectOverride = options.projectFile === undefined ? populated(env.NEOTTIA_CONFIG_FILE) : undefined;
  if (options.projectFile !== false) {
    const configured = typeof options.projectFile === 'string' ? options.projectFile : projectOverride;
    selections.push({
      explicit: configured !== undefined,
      file: configured === undefined ? path.join(cwd, '.neottia', 'config.yml') : resolveFrom(cwd, configured),
      kind: 'project',
    });
  }
  return selections;
}

/** Reads at most the published byte limit from one regular file descriptor. */
function readBoundedConfigFile(
  file: string,
): { readonly kind: 'success'; readonly yaml: string } | { readonly kind: 'io' | 'limit' } {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, 'r');
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) return { kind: 'io' };
    if (metadata.size > MAX_CONFIG_FILE_BYTES) return { kind: 'limit' };

    const buffer = Buffer.allocUnsafe(MAX_CONFIG_FILE_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.byteLength) {
      const count = readSync(descriptor, buffer, bytesRead, buffer.byteLength - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > MAX_CONFIG_FILE_BYTES) return { kind: 'limit' };
    return { kind: 'success', yaml: buffer.subarray(0, bytesRead).toString('utf8') };
  } catch {
    return { kind: 'io' };
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The read result already captures the actionable file failure.
      }
    }
  }
}

/** Checks collection depth and node count before aliases can expand during conversion. */
function yamlStructureWithinLimits(root: Node | null | undefined): boolean {
  let nodes = 0;
  const visit = (node: Node | null | undefined, depth: number): boolean => {
    if (node === null || node === undefined) return true;
    nodes += 1;
    if (nodes > MAX_CONFIG_YAML_NODES || depth > MAX_CONFIG_YAML_DEPTH) return false;
    if (isSeq(node)) return node.items.every((item) => visit(item as Node | null, depth + 1));
    if (isMap(node)) {
      return node.items.every(
        (pair) => visit(pair.key as Node | null, depth + 1) && visit(pair.value as Node | null, depth + 1),
      );
    }
    return true;
  };
  return visit(root, 0);
}

/** Reads and parses a selected YAML document once, then validates every fragment once. */
function loadDocument(
  registry: ConfigRegistry,
  selection: SourceSelection,
  parsedFiles: Map<string, unknown>,
  collector: MutableDiagnosticCollector,
  ignoreUnregisteredPaths: boolean,
): LoadedDocument | undefined {
  if (!existsSync(selection.file)) {
    if (selection.explicit) {
      addDiagnostic(collector, {
        code: 'IO',
        message: `explicit ${selection.kind} configuration file does not exist`,
        source: { file: selection.file, kind: selection.kind },
      });
    }
    return undefined;
  }

  let root = parsedFiles.get(selection.file);
  if (!parsedFiles.has(selection.file)) {
    const source: ConfigProvenance = { file: selection.file, kind: selection.kind };
    const loaded = readBoundedConfigFile(selection.file);
    if (loaded.kind !== 'success') {
      addDiagnostic(collector, {
        code: loaded.kind === 'limit' ? 'LIMIT' : 'IO',
        message:
          loaded.kind === 'limit'
            ? 'configuration file exceeds the maximum byte size'
            : 'configuration file could not be read as a regular file',
        source,
      });
      parsedFiles.set(selection.file, undefined);
      return undefined;
    }
    try {
      const document = parseDocument(loaded.yaml, { prettyErrors: false, uniqueKeys: true });
      if (document.errors.length > 0 || document.warnings.length > 0) {
        addDiagnostic(collector, {
          code: 'YAML',
          message: 'configuration file contains invalid or duplicate YAML mapping keys',
          source,
        });
        parsedFiles.set(selection.file, undefined);
        return undefined;
      }
      if (!yamlStructureWithinLimits(document.contents)) {
        addDiagnostic(collector, {
          code: 'LIMIT',
          message: 'configuration YAML exceeds the maximum depth or node count',
          source,
        });
        parsedFiles.set(selection.file, undefined);
        return undefined;
      }
      root = document.toJS({ maxAliasCount: 100 }) as unknown;
      if (root === null) root = {};
      parsedFiles.set(selection.file, root);
    } catch {
      addDiagnostic(collector, {
        code: 'YAML',
        message: 'configuration file could not be decoded as bounded YAML data',
        source,
      });
      parsedFiles.set(selection.file, undefined);
      return undefined;
    }
  }
  if (root === undefined) return undefined;

  const source: ConfigProvenance = { file: selection.file, kind: selection.kind };
  if (!isRecord(root)) {
    addDiagnostic(collector, { code: 'YAML', message: 'configuration document must be a mapping', source });
    return undefined;
  }
  validateVersion(root, source, collector);
  const baseRoot = Object.fromEntries(Object.entries(root).filter(([key]) => key !== 'version' && key !== 'profiles'));
  const base = validateFragment(registry, baseRoot, source, 'file', collector, [], ignoreUnregisteredPaths);
  const profiles = validateProfiles(registry, root.profiles, selection, collector, ignoreUnregisteredPaths);
  return {
    base: base ?? { shards: new Map() },
    file: selection.file,
    kind: selection.kind,
    profiles,
  };
}

/** Requires an explicitly declared version to be the only supported integer version. */
function validateVersion(
  root: Readonly<Record<string, unknown>>,
  source: ConfigProvenance,
  collector: MutableDiagnosticCollector,
): void {
  if (root.version !== 1) {
    addDiagnostic(collector, {
      code: 'VERSION',
      message: 'configuration version must be the supported integer version 1',
      path: ['version'],
      source,
    });
  }
}

/** Validates and caches every declared profile, including profiles not selected. */
function validateProfiles(
  registry: ConfigRegistry,
  candidate: unknown,
  selection: SourceSelection,
  collector: MutableDiagnosticCollector,
  ignoreUnregisteredPaths: boolean,
): ReadonlyMap<string, ValidatedFragment> {
  const profiles = new Map<string, ValidatedFragment>();
  if (candidate === undefined) return profiles;
  const fileSource: ConfigProvenance = { file: selection.file, kind: selection.kind };
  if (!isRecord(candidate)) {
    addDiagnostic(collector, {
      code: 'PROFILE',
      message: 'profiles must be a mapping of names to configuration fragments',
      path: ['profiles'],
      source: fileSource,
    });
    return profiles;
  }
  for (const [name, fragment] of Object.entries(candidate)) {
    const source: ConfigProvenance = { file: selection.file, kind: 'profile', profile: name };
    if (name.length === 0 || name.trim() !== name) {
      addDiagnostic(collector, {
        code: 'PROFILE',
        message: 'profile names must be non-empty trimmed strings',
        path: ['profiles', name],
        source,
      });
      continue;
    }
    const validated = validateFragment(
      registry,
      fragment,
      source,
      'file',
      collector,
      ['profiles', name],
      ignoreUnregisteredPaths,
    );
    if (validated !== undefined) profiles.set(name, validated);
  }
  return profiles;
}

/** Validates root ownership and each located shard with its layer-specific schema. */
function validateFragment(
  registry: ConfigRegistry,
  candidate: unknown,
  source: ConfigProvenance,
  mode: 'file' | 'runtime',
  collector: MutableDiagnosticCollector,
  prefix: readonly string[] = [],
  ignoreUnregisteredPaths = false,
): ValidatedFragment | undefined {
  if (!isRecord(candidate)) {
    addDiagnostic(collector, {
      code: source.kind === 'profile' ? 'PROFILE' : 'PATH',
      message: 'configuration fragment must be a mapping',
      path: prefix,
      source,
    });
    return undefined;
  }

  const ownedPaths = registry.contributions.flatMap((contribution) => [
    contribution.path,
    ...(mode === 'file' ? (contribution.legacyPaths ?? []) : []),
  ]);
  validateOwnedTree(candidate, [], ownedPaths, source, prefix, collector, ignoreUnregisteredPaths);

  const shards = new Map<string, LocatedShard>();
  for (const contribution of registry.contributions) {
    const possiblePaths = [contribution.path, ...(mode === 'file' ? (contribution.legacyPaths ?? []) : [])];
    const located = possiblePaths
      .filter((ownedPath) => hasAtPath(candidate, ownedPath))
      .map((actualPath) => ({ actualPath, patch: getAtPath(candidate, actualPath) }));
    if (located.length > 1) {
      addDiagnostic(collector, {
        code: 'MERGE',
        message: `contribution "${contribution.id}" is declared at more than one owned path in one source`,
        path: prefix,
        source,
      });
      continue;
    }
    const found = located[0];
    if (found === undefined) continue;
    const schema = mode === 'file' ? contribution.filePatchSchema : contribution.runtimePatchSchema;
    const result = schema.safeParse(found.patch);
    // Secret diagnostics remain actionable even when the file schema rejects the same literal.
    if (mode === 'file') {
      validateSecretReferences(contribution, found.patch, [...prefix, ...found.actualPath], source, collector);
    }
    if (!result.success) {
      addSchemaDiagnostics(collector, contribution, [...prefix, ...found.actualPath], result.error.issues, source);
      continue;
    }
    const legacyPath = pathsEqual(found.actualPath, contribution.path) ? undefined : found.actualPath;
    shards.set(contribution.id, {
      actualPath: found.actualPath,
      legacyPath,
      patch: result.data,
    });
  }
  return { shards };
}

/** Rejects keys and non-mapping path containers not owned by a contribution. */
function validateOwnedTree(
  candidate: unknown,
  currentPath: readonly string[],
  ownedPaths: readonly (readonly string[])[],
  source: ConfigProvenance,
  prefix: readonly string[],
  collector: MutableDiagnosticCollector,
  ignoreUnregisteredPaths: boolean,
): void {
  if (ownedPaths.some((ownedPath) => pathsEqual(ownedPath, currentPath))) return;
  if (!isRecord(candidate)) {
    addDiagnostic(collector, {
      code: source.kind === 'profile' ? 'PROFILE' : 'PATH',
      message: 'configuration ownership path must contain a mapping',
      path: [...prefix, ...currentPath],
      source,
    });
    return;
  }
  for (const [key, child] of Object.entries(candidate)) {
    const childPath = [...currentPath, key];
    const possible = ownedPaths.filter((ownedPath) => isPrefix(childPath, ownedPath));
    const reservedRoot = currentPath.length === 0 && CONFIG_ROOT_SECTIONS.some((section) => section === key);
    if (possible.length === 0 && !reservedRoot) {
      if (!ignoreUnregisteredPaths) {
        addDiagnostic(collector, {
          code: source.kind === 'profile' ? 'PROFILE' : 'PATH',
          message: 'configuration path is not owned by a registered contribution',
          path: [...prefix, ...childPath],
          source,
        });
      }
      continue;
    }
    validateOwnedTree(child, childPath, possible, source, prefix, collector, ignoreUnregisteredPaths);
  }
}

/** Adds value-free diagnostics for schema issue paths. */
function addSchemaDiagnostics(
  collector: MutableDiagnosticCollector,
  contribution: UnknownConfigContribution,
  shardPath: readonly string[],
  issues: readonly {
    readonly code?: string;
    readonly keys?: readonly string[];
    readonly path: readonly PropertyKey[];
  }[],
  source: ConfigProvenance,
): void {
  for (const issue of issues) {
    // Unknown key names are safe structural metadata and make strict-schema failures actionable.
    const suffixes =
      issue.code === 'unrecognized_keys' && issue.keys !== undefined ? issue.keys.map((key) => [key]) : [[]];
    for (const suffix of suffixes) {
      addDiagnostic(collector, {
        code: 'SCHEMA',
        message: `configuration for contribution "${contribution.id}" does not satisfy its registered schema`,
        path: [...shardPath, ...issue.path.map(String), ...suffix],
        source,
      });
    }
  }
}

/** File and profile layers may contain only exact environment references at secret paths. */
function validateSecretReferences(
  contribution: UnknownConfigContribution,
  patch: unknown,
  shardPath: readonly string[],
  source: ConfigProvenance,
  collector: MutableDiagnosticCollector,
): void {
  for (const secret of contribution.secrets ?? []) {
    if (!hasAtPath(patch, secret.path)) continue;
    const value = getAtPath(patch, secret.path);
    if (typeof value !== 'string' || !ENVIRONMENT_REFERENCE.test(value)) {
      addDiagnostic(collector, {
        code: 'SECRET',
        message: 'file-facing secret must be an exact ${ENV_VAR} reference',
        path: [...shardPath, ...secret.path],
        source,
      });
    }
  }
}

/** Selects at most one exact profile name with explicit input taking precedence. */
function selectProfile(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  collector: MutableDiagnosticCollector,
): string | undefined {
  const selected = explicit ?? populated(env.NEOTTIA_PROFILE);
  if (selected !== undefined && (selected.length === 0 || selected.trim() !== selected)) {
    addDiagnostic(collector, { code: 'PROFILE', message: 'selected profile must be a non-empty trimmed string' });
    return undefined;
  }
  return selected;
}

/** Starts every contribution from a detached copy of its complete defaults. */
function initializeDefaults(registry: ConfigRegistry): Map<string, MutableResolution> {
  const resolutions = new Map<string, MutableResolution>();
  for (const contribution of registry.contributions) {
    const provenance = new Map<string, ConfigProvenance>();
    const value = cloneMutable(contribution.defaults);
    recordLeafProvenance(value, [], { kind: 'defaults' }, provenance);
    resolutions.set(contribution.id, { provenance, value });
  }
  return resolutions;
}

/** Applies all source shards without reparsing the containing document or fragment. */
function applyFragment(
  resolutions: Map<string, MutableResolution>,
  fragment: ValidatedFragment,
  source: ConfigProvenance,
): void {
  for (const [id, located] of fragment.shards) {
    const resolution = resolutions.get(id);
    if (resolution === undefined) continue;
    const provenance = located.legacyPath === undefined ? source : { ...source, legacyPath: located.legacyPath };
    resolution.value = mergeValues(resolution.value, located.patch, [], provenance, resolution.provenance);
  }
}

/** Applies registered environment bindings after all file and profile layers. */
function applyEnvironment(
  registry: ConfigRegistry,
  resolutions: Map<string, MutableResolution>,
  env: Readonly<Record<string, string | undefined>>,
  collector: MutableDiagnosticCollector,
): void {
  for (const contribution of registry.contributions) {
    const resolution = resolutions.get(contribution.id);
    if (resolution === undefined) continue;
    for (const binding of contribution.environment ?? []) {
      const selected = firstPopulated(binding.names, env);
      if (selected === undefined) continue;
      const source: ConfigProvenance = { environment: selected.name, kind: 'environment' };
      let coerced: unknown;
      try {
        coerced =
          binding.parse === undefined ? coerceEnvironment(selected.value, binding.kind) : binding.parse(selected.value);
      } catch {
        addEnvironmentDiagnostic(collector, contribution, binding.path, source);
        continue;
      }
      if (coerced === undefined) {
        addEnvironmentDiagnostic(
          collector,
          contribution,
          binding.path,
          source,
          binding.parse === undefined ? `environment variable must contain a valid ${binding.kind}` : undefined,
        );
        continue;
      }
      const patch = objectAtPath(binding.path, coerced);
      if (!contribution.runtimePatchSchema.safeParse(patch).success) {
        addEnvironmentDiagnostic(collector, contribution, binding.path, source);
        continue;
      }
      resolution.value = mergeValues(resolution.value, patch, [], source, resolution.provenance);
    }
    for (const secret of contribution.secrets ?? []) {
      if (secret.fallbackEnvironment === undefined) continue;
      const selected = firstPopulated(secret.fallbackEnvironment, env);
      if (selected === undefined) continue;
      resolution.value = mergeValues(
        resolution.value,
        objectAtPath(secret.path, selected.value),
        [],
        { environment: selected.name, kind: 'environment' },
        resolution.provenance,
      );
    }
  }
}

/** Resolves only winning file-facing references and never recursively expands environment content. */
function resolveSecrets(
  registry: ConfigRegistry,
  resolutions: Map<string, MutableResolution>,
  env: Readonly<Record<string, string | undefined>>,
  collector: MutableDiagnosticCollector,
  resolveOverrideReferences: boolean,
): void {
  for (const contribution of registry.contributions) {
    const resolution = resolutions.get(contribution.id);
    if (resolution === undefined) continue;
    for (const secret of contribution.secrets ?? []) {
      if (!hasAtPath(resolution.value, secret.path)) continue;
      const source = resolution.provenance.get(pathKey(secret.path));
      const resolvableKinds = resolveOverrideReferences
        ? ['global', 'project', 'profile', 'override']
        : ['global', 'project', 'profile'];
      if (source === undefined || !resolvableKinds.includes(source.kind)) continue;
      const reference = getAtPath(resolution.value, secret.path);
      if (typeof reference !== 'string' || !ENVIRONMENT_REFERENCE.test(reference)) continue;
      const name = reference.slice(2, -1);
      const value = populated(env[name]);
      if (value === undefined) {
        addDiagnostic(collector, {
          code: 'SECRET',
          message: 'referenced secret environment variable is not populated',
          path: [...contribution.path, ...secret.path],
          source: { ...source, environment: name },
        });
        continue;
      }
      setAtPath(resolution.value, secret.path, value);
    }
  }
}

/** Recursively merges mappings and replaces arrays and scalar leaves. */
function mergeValues(
  lower: unknown,
  higher: unknown,
  currentPath: readonly string[],
  source: ConfigProvenance,
  provenance: Map<string, ConfigProvenance>,
): unknown {
  if (isRecord(lower) && isRecord(higher)) {
    for (const [key, value] of Object.entries(higher)) {
      const childPath = [...currentPath, key];
      lower[key] = mergeValues(lower[key], value, childPath, source, provenance);
    }
    return lower;
  }
  clearProvenance(currentPath, provenance);
  const replacement = cloneMutable(higher);
  recordLeafProvenance(replacement, currentPath, source, provenance);
  return replacement;
}

/** Records scalar and complete-array provenance at canonical shard-relative leaves. */
function recordLeafProvenance(
  value: unknown,
  currentPath: readonly string[],
  source: ConfigProvenance,
  provenance: Map<string, ConfigProvenance>,
): void {
  if (Array.isArray(value) || !isRecord(value)) {
    provenance.set(pathKey(currentPath), source);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    recordLeafProvenance(child, [...currentPath, key], source, provenance);
  }
}

/** Removes obsolete descendant metadata when a higher layer replaces a subtree. */
function clearProvenance(target: readonly string[], provenance: Map<string, ConfigProvenance>): void {
  for (const key of provenance.keys()) {
    const path = JSON.parse(key) as string[];
    if (isPrefix(target, path)) provenance.delete(key);
  }
}

/** Converts mutable provenance maps to snapshot constructor records. */
function serializeProvenance(
  resolutions: ReadonlyMap<string, MutableResolution>,
): Readonly<Record<string, Readonly<Record<string, ConfigProvenance>>>> {
  return Object.fromEntries(
    [...resolutions].map(([id, resolution]) => [id, Object.fromEntries(resolution.provenance)]),
  );
}

/** Reports domain-specific and built-in environment conversion failures without raw values. */
function addEnvironmentDiagnostic(
  collector: MutableDiagnosticCollector,
  contribution: UnknownConfigContribution,
  pathSegments: readonly string[],
  source: ConfigProvenance,
  message = 'environment variable could not be converted to the registered setting',
): void {
  addDiagnostic(collector, {
    code: 'ENVIRONMENT',
    message,
    path: [...contribution.path, ...pathSegments],
    source,
  });
}

/** Coerces only strict, unsurprising environment spellings. */
function coerceEnvironment(
  value: string,
  kind: 'string' | 'integer' | 'boolean',
): string | number | boolean | undefined {
  if (kind === 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (kind === 'boolean') {
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return undefined;
  }
  if (!/^-?(?:0|[1-9]\d*)$/u.test(normalized)) return undefined;
  const integer = Number(normalized);
  return Number.isSafeInteger(integer) ? integer : undefined;
}

/** Returns the first non-empty variable according to contribution precedence. */
function firstPopulated(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { readonly name: string; readonly value: string } | undefined {
  for (const name of names) {
    const value = populated(env[name]);
    if (value !== undefined) return { name, value };
  }
  return undefined;
}

/** Empty environment values are consistently treated as unset. */
function populated(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

/** Creates one nested runtime patch for a relative binding path. */
function objectAtPath(pathSegments: readonly string[], value: unknown): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  setAtPath(root, pathSegments, value);
  return root;
}

/** Reads a complete path without interpreting dots in key names. */
function getAtPath(value: unknown, pathSegments: readonly string[]): unknown {
  let current = value;
  for (const segment of pathSegments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Checks own-property presence for a complete path. */
function hasAtPath(value: unknown, pathSegments: readonly string[]): boolean {
  let current = value;
  for (const segment of pathSegments) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

/** Assigns a non-empty path in resolver-owned mutable data. */
function setAtPath(target: unknown, pathSegments: readonly string[], value: unknown): void {
  if (!isRecord(target) || pathSegments.length === 0) return;
  let current = target;
  for (const segment of pathSegments.slice(0, -1)) {
    if (!isRecord(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[pathSegments.at(-1) as string] = value;
}

/** Clones plain configuration data before mutable resolution begins. */
function cloneMutable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneMutable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneMutable(child)]));
}

/** Plain mappings are the only values merged recursively. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Tests exact path equality. */
function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

/** Tests whether one path is an exact segment prefix of another. */
function isPrefix(prefix: readonly string[], pathSegments: readonly string[]): boolean {
  return prefix.length <= pathSegments.length && prefix.every((segment, index) => segment === pathSegments[index]);
}

/** Encodes paths without ambiguity from dotted key segments. */
function pathKey(pathSegments: readonly string[]): string {
  return JSON.stringify(pathSegments);
}

/** Resolves explicit relative paths against the invocation cwd. */
function resolveFrom(cwd: string, configured: string): string {
  return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(cwd, configured);
}

/** Creates a bounded collector. */
function createCollector(): MutableDiagnosticCollector {
  return { diagnostics: [], omitted: 0 };
}

/** Retains at most the published diagnostic bound. */
function addDiagnostic(collector: MutableDiagnosticCollector, diagnostic: ConfigDiagnostic): void {
  if (collector.diagnostics.length < MAX_CONFIG_DIAGNOSTICS - 1) collector.diagnostics.push(diagnostic);
  else collector.omitted += 1;
}

/** Throws one immutable bounded error after all independent checks complete. */
function throwIfDiagnostics(collector: MutableDiagnosticCollector): void {
  if (collector.diagnostics.length === 0 && collector.omitted === 0) return;
  if (collector.omitted > 0) {
    collector.diagnostics.push({
      code: 'LIMIT',
      message: 'additional configuration diagnostics were omitted at the published limit',
    });
  }
  throw new ConfigResolutionError(collector.diagnostics);
}

/** Freezes copied diagnostic metadata before exposing an error. */
function freezeDiagnostics(diagnostics: readonly ConfigDiagnostic[]): readonly ConfigDiagnostic[] {
  return Object.freeze(
    diagnostics.slice(0, MAX_CONFIG_DIAGNOSTICS).map((diagnostic) =>
      Object.freeze({
        ...diagnostic,
        path: diagnostic.path ? Object.freeze([...diagnostic.path]) : undefined,
        source: diagnostic.source
          ? Object.freeze({
              ...diagnostic.source,
              legacyPath: diagnostic.source.legacyPath ? Object.freeze([...diagnostic.source.legacyPath]) : undefined,
            })
          : undefined,
      }),
    ),
  );
}
