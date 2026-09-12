import type {
  ConfigContribution,
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

interface SnapshotState {
  readonly contributionIds: ReadonlyMap<UnknownConfigContribution, string>;
  readonly shards: ReadonlyMap<string, unknown>;
}

const snapshotStates = new WeakMap<ResolvedConfigSnapshot, SnapshotState>();

/** Builds a coherent snapshot, using contribution defaults for omitted shards. */
export function createResolvedConfigSnapshot(
  registry: ConfigRegistry,
  values: ConfigShardValues = {},
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
    const parsed = contribution.resolvedSchema.safeParse(candidate);
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

  const snapshot: ResolvedConfigSnapshot = Object.freeze({
    get<FilePatch, RuntimePatch, Resolved>(
      contribution: ConfigContribution<FilePatch, RuntimePatch, Resolved>,
    ): DeepReadonly<Resolved> {
      const state = snapshotStates.get(snapshot);
      const id = state?.contributionIds.get(contribution as UnknownConfigContribution);
      if (id === undefined || state === undefined) {
        throw new ConfigSnapshotError(
          'UNKNOWN_CONTRIBUTION',
          'requested contribution is not registered in this snapshot',
        );
      }
      return state.shards.get(id) as DeepReadonly<Resolved>;
    },
  });
  snapshotStates.set(snapshot, { contributionIds: registryState.contributionIds, shards });
  return snapshot;
}

/** Snapshot construction accepts only a direct plain-object ID map. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
