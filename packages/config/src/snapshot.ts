import type {
  ConfigContribution,
  ConfigDiagnostic,
  ConfigProvenance,
  ConfigRegistry,
  DeepReadonly,
  ResolvedConfigSnapshot,
  UnknownConfigContribution,
} from './contracts.js';
import { cloneAndFreezeConfigValue } from './immutable.js';
import { getRegistryState } from './registry.js';

/** Stable categories for immutable snapshot construction and access failures. */
export type ConfigSnapshotErrorCode =
  'INVALID_REGISTRY' | 'INVALID_SHARD' | 'INVALID_SHARD_VALUES' | 'UNKNOWN_CONTRIBUTION' | 'UNKNOWN_SHARD';

/** Reports snapshot failures without including rejected configuration values. */
export class ConfigSnapshotError extends Error {
  readonly code: ConfigSnapshotErrorCode;
  readonly contributionId?: string;

  constructor(code: ConfigSnapshotErrorCode, message: string, contributionId?: string) {
    super(message);
    this.name = 'ConfigSnapshotError';
    this.code = code;
    this.contributionId = contributionId;
  }
}

/** Resolved shards keyed by their registered contribution IDs. */
export type ConfigShardValues = Readonly<Record<string, unknown>>;

/** Resolver-owned metadata attached while constructing a snapshot. */
interface ConfigSnapshotMetadata {
  readonly diagnostics?: readonly ConfigDiagnostic[];
  readonly provenance?: Readonly<Record<string, Readonly<Record<string, ConfigProvenance>>>>;
  /** Internal resolver signal that supplied shards are already parsed schema outputs. */
  readonly validatedShards?: boolean;
}

interface SnapshotState {
  readonly contributionIds: ReadonlyMap<UnknownConfigContribution, string>;
  readonly provenance: ReadonlyMap<string, ReadonlyMap<string, ConfigProvenance>>;
  readonly shards: ReadonlyMap<string, unknown>;
}

const REDACTED_VALUE = '[REDACTED]';
const snapshotStates = new WeakMap<ResolvedConfigSnapshot, SnapshotState>();

/** Builds a coherent snapshot, using contribution defaults for omitted shards. */
export function createResolvedConfigSnapshot(
  registry: ConfigRegistry,
  values: ConfigShardValues = {},
): ResolvedConfigSnapshot {
  return createSnapshot(registry, values, {});
}

/** Builds a snapshot from resolver outputs that have already passed resolved schemas. */
export function createResolvedConfigSnapshotWithMetadata(
  registry: ConfigRegistry,
  values: ConfigShardValues,
  metadata: ConfigSnapshotMetadata,
): ResolvedConfigSnapshot {
  return createSnapshot(registry, values, metadata);
}

/** Implements both public trusted construction and parse-once resolver construction. */
function createSnapshot(
  registry: ConfigRegistry,
  values: ConfigShardValues,
  metadata: ConfigSnapshotMetadata,
): ResolvedConfigSnapshot {
  const registryState = getRegistryState(registry);
  if (registryState === undefined) {
    throw new ConfigSnapshotError('INVALID_REGISTRY', 'snapshot registry was not created by @neottia/config');
  }
  if (!isRecord(values)) {
    throw new ConfigSnapshotError('INVALID_SHARD_VALUES', 'snapshot shard values must be a plain object');
  }

  const unknownIds = Object.keys(values)
    .filter((id) => !registryState.contributionsById.has(id))
    .sort();
  if (unknownIds.length > 0) {
    throw new ConfigSnapshotError(
      'UNKNOWN_SHARD',
      `snapshot contains unregistered shard "${unknownIds[0]}"`,
      unknownIds[0],
    );
  }

  const shards = new Map<string, unknown>();
  for (const [id, contribution] of registryState.contributionsById) {
    const candidate = Object.prototype.hasOwnProperty.call(values, id) ? values[id] : contribution.defaults;
    const parsed = metadata.validatedShards
      ? { data: candidate, success: true as const }
      : contribution.resolvedSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ConfigSnapshotError(
        'INVALID_SHARD',
        `resolved shard "${id}" does not satisfy its registered schema`,
        id,
      );
    }
    try {
      shards.set(id, cloneAndFreezeConfigValue(parsed.data));
    } catch {
      throw new ConfigSnapshotError('INVALID_SHARD', `resolved shard "${id}" is not immutable config data`, id);
    }
  }

  const provenance = freezeProvenance(metadata.provenance, registryState.contributionsById);
  const diagnostics = freezeDiagnostics(metadata.diagnostics ?? []);
  const snapshot: ResolvedConfigSnapshot = Object.freeze({
    diagnostics,
    get<FilePatch, RuntimePatch, Resolved>(
      contribution: ConfigContribution<FilePatch, RuntimePatch, Resolved>,
    ): DeepReadonly<Resolved> {
      const { id, state } = getSnapshotContribution(snapshot, contribution);
      return state.shards.get(id) as DeepReadonly<Resolved>;
    },
    sourceOf<FilePatch, RuntimePatch, Resolved>(
      contribution: ConfigContribution<FilePatch, RuntimePatch, Resolved>,
      path: readonly string[],
    ): ConfigProvenance | undefined {
      const { id, state } = getSnapshotContribution(snapshot, contribution);
      return state.provenance.get(id)?.get(pathKey(path));
    },
    toJSON(): DeepReadonly<Record<string, unknown>> {
      const state = snapshotStates.get(snapshot);
      if (state === undefined) {
        throw new ConfigSnapshotError('INVALID_REGISTRY', 'snapshot state is unavailable');
      }
      const document: Record<string, unknown> = { version: 1 };
      for (const contribution of registry.contributions) {
        const shard = cloneMutable(state.shards.get(contribution.id));
        for (const secret of contribution.secrets ?? []) {
          if (hasAtPath(shard, secret.path)) setAtPath(shard, secret.path, REDACTED_VALUE);
        }
        setAtPath(document, contribution.path, shard);
      }
      return cloneAndFreezeConfigValue(document);
    },
  });
  snapshotStates.set(snapshot, { contributionIds: registryState.contributionIds, provenance, shards });
  return snapshot;
}

/** Resolves and checks the private identity mapping for typed snapshot methods. */
function getSnapshotContribution<FilePatch, RuntimePatch, Resolved>(
  snapshot: ResolvedConfigSnapshot,
  contribution: ConfigContribution<FilePatch, RuntimePatch, Resolved>,
): { readonly id: string; readonly state: SnapshotState } {
  const state = snapshotStates.get(snapshot);
  const id = state?.contributionIds.get(contribution as UnknownConfigContribution);
  if (id === undefined || state === undefined) {
    throw new ConfigSnapshotError('UNKNOWN_CONTRIBUTION', 'requested contribution is not registered in this snapshot');
  }
  return { id, state };
}

/** Copies diagnostics so mutable caller metadata cannot alter a snapshot. */
function freezeDiagnostics(diagnostics: readonly ConfigDiagnostic[]): readonly ConfigDiagnostic[] {
  return Object.freeze(
    diagnostics.map((diagnostic) =>
      Object.freeze({
        ...diagnostic,
        path: diagnostic.path ? Object.freeze([...diagnostic.path]) : undefined,
        source: diagnostic.source ? freezeSource(diagnostic.source) : undefined,
      }),
    ),
  );
}

/** Copies provenance into maps keyed by unambiguous JSON path encodings. */
function freezeProvenance(
  metadata: ConfigSnapshotMetadata['provenance'],
  contributions: ReadonlyMap<string, UnknownConfigContribution>,
): ReadonlyMap<string, ReadonlyMap<string, ConfigProvenance>> {
  const result = new Map<string, ReadonlyMap<string, ConfigProvenance>>();
  for (const id of contributions.keys()) {
    const entries = Object.entries(metadata?.[id] ?? {}).map(([key, source]) => [key, freezeSource(source)] as const);
    result.set(id, new Map(entries));
  }
  return result;
}

/** Freezes source metadata and its optional legacy path. */
function freezeSource(source: ConfigProvenance): ConfigProvenance {
  return Object.freeze({
    ...source,
    legacyPath: source.legacyPath ? Object.freeze([...source.legacyPath]) : undefined,
  });
}

/** Snapshot construction accepts only a direct plain-object ID map. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Encodes paths without dot-segment ambiguity. */
function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

/** Produces a mutable data copy used only to construct redacted serialization. */
function cloneMutable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneMutable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneMutable(child)]));
}

/** Checks whether a complete relative path exists. */
function hasAtPath(value: unknown, path: readonly string[]): boolean {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

/** Assigns a path while constructing a fresh serialization object. */
function setAtPath(target: unknown, path: readonly string[], value: unknown): void {
  if (!isRecord(target) || path.length === 0) return;
  let current = target;
  for (const segment of path.slice(0, -1)) {
    const child = current[segment];
    if (!isRecord(child)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[path.at(-1) as string] = value;
}
