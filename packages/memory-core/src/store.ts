import { FilesystemBackend } from './backend/filesystem.js';
import type { ShardState, StorageReplacement } from './backend/types.js';
import { withShardBarrier, withShardBarrierAsync } from './barrier.js';
import type { MemoryConfig } from './config.js';
import { MemoryConflictError, MemoryError } from './errors.js';
import { isUlid } from './identities.js';
import { canonicalHash, SqliteIndex } from './index-sqlite.js';
import {
  memoryRecordSchema,
  memoryTombstoneSchema,
  type MemoryRecord,
  type MemorySource,
  type MemoryTombstone,
} from './schemas.js';

/**
 * MemoryStore: the facade behind the memory_* tool surface. Operations run
 * inside a shard-scoped barrier; mutations re-validate canonical state and
 * resynchronize the disposable SQLite index afterwards. Ported from the
 * harnessctl-v2 memory implementation with the issue-graph coupling removed.
 */

export interface StoreMemoryInput {
  memory_type: MemoryRecord['memory_type'];
  record_type: MemoryRecord['record_type'];
  topic?: string;
  summary: string;
  details?: string | null;
  source: MemorySource;
  created_by: string;
  confidence: MemoryRecord['confidence'];
  tags?: string[];
}

export interface SearchMemoryInput {
  query?: string;
  topic?: string;
  memory_type?: string;
  limit?: number;
  max_chars?: number;
  include_superseded?: boolean;
}

export interface MemoryValidationReport {
  valid: boolean;
  records: number;
  tombstones: number;
  errors: string[];
  cache:
    | { outcome: 'checked'; evidence: 'canonical_snapshot_match_verified' }
    | { outcome: 'rebuilt'; evidence: 'canonical_snapshot_rebuild_verified' }
    | { outcome: 'skipped'; evidence: 'memory_validation_failed' };
}

export interface ImportReport {
  valid: boolean;
  records: number;
  tombstones: number;
  errors: string[];
}

export interface MemoryStoreOptions {
  readonly config: MemoryConfig;
  readonly cwd: string;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
  /**
   * Host hook for stale_policy 'prompt' (neottia#1 decision #5): called when
   * the cache is stale; returning true rebuilds, false errors. When absent,
   * 'prompt' degrades to a silent rebuild (non-interactive hosts).
   */
  readonly onStaleCache?: () => boolean | Promise<boolean>;
}

const MAX_QUERY_BYTES = 16 * 1024;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;

export class MemoryStore {
  private readonly backend: FilesystemBackend;
  private readonly config: MemoryConfig;
  private readonly now: () => Date;
  private readonly onStaleCache?: () => boolean | Promise<boolean>;

  public constructor(options: MemoryStoreOptions) {
    if (options.config.backend !== 'filesystem')
      throw new MemoryError(`Memory backend '${options.config.backend}' is not implemented yet; see neottia#6.`);
    this.config = options.config;
    this.now = options.now ?? (() => new Date());
    this.onStaleCache = options.onStaleCache;
    this.backend = new FilesystemBackend({ config: options.config, cwd: options.cwd });
  }

  /** Builds a store from a resolved config shard. */
  public static fromConfig(config: MemoryConfig, cwd: string): MemoryStore {
    return new MemoryStore({ config, cwd });
  }

  /** Lock identity of the namespace shard this store writes to. */
  public get scopeKey(): string {
    const namespace = this.config.namespace;
    return `${namespace.organization_id}--${namespace.project_id}--${namespace.scope}`;
  }

  /** Stores a new active memory record. */
  public store(input: StoreMemoryInput): MemoryRecord {
    this.backend.validateCompactness(input.summary, input.details, 'memory_store');
    return this.executeMutation(() => {
      const state = this.loadState();
      const record = this.backend.makeRecord(input, [], this.now);
      this.assertUniqueId(state, record.id);
      this.applyBatch([{ path: this.backend.recordPath(record), bytes: this.backend.encode(record), exclusive: true }]);
      return record;
    });
  }

  /** Stores a replacement record that supersedes an active target. */
  public supersede(targetId: string, input: StoreMemoryInput): MemoryRecord {
    assertUlid(targetId, 'target_id');
    this.backend.validateCompactness(input.summary, input.details, 'memory_supersede');
    return this.executeMutation(() => {
      const state = this.loadState();
      this.requireActiveTarget(state, targetId);
      const record = this.backend.makeRecord(input, [targetId], this.now);
      this.assertUniqueId(state, record.id);
      this.applyBatch([{ path: this.backend.recordPath(record), bytes: this.backend.encode(record), exclusive: true }]);
      return record;
    });
  }

  /** Tombstones an active record; canonical files are never deleted. */
  public delete(targetId: string, reason: string, source: MemorySource, createdBy: string): MemoryTombstone {
    assertUlid(targetId, 'target_id');
    return this.executeMutation(() => {
      const state = this.loadState();
      this.requireActiveTarget(state, targetId);
      const tombstone = this.backend.makeTombstone(targetId, reason, source, createdBy, this.now);
      this.assertUniqueId(state, tombstone.id);
      this.applyBatch([
        { path: this.backend.tombstonePath(tombstone), bytes: this.backend.encode(tombstone), exclusive: true },
      ]);
      return tombstone;
    });
  }

  /** Fetches one record or tombstone by ULID. */
  public get(id: string): MemoryRecord | MemoryTombstone {
    assertUlid(id, 'id');
    return this.executeRead((state) => {
      const result = [...state.records, ...state.tombstones].find((item) => item.id === id);
      if (!result) throw new MemoryError(`Memory record not found: ${id}`);
      return result;
    });
  }

  /** Lists records, newest first, with optional topic/type filters. */
  public list(input: SearchMemoryInput = {}): MemoryRecord[] {
    return this.executeRead((state) => {
      const includeSuperseded = input.include_superseded ?? this.config.retrieval.include_superseded;
      const limit = bounded(input.limit ?? this.config.retrieval.limit, 1, 100, 'limit');
      return state.records
        .filter((record) => includeSuperseded || state.activeIds.has(record.id))
        .filter((record) => !input.topic || record.topic === input.topic)
        .filter((record) => !input.memory_type || record.memory_type === input.memory_type)
        .slice(0, limit);
    });
  }

  /**
   * BM25-ranked search through the SQLite index (rebuilding it first when
   * stale). Results stay bounded by both limit and the JSON-size budget
   * inherited from the v1 semantics.
   */
  public async search(input: SearchMemoryInput = {}): Promise<MemoryRecord[]> {
    const query = input.query;
    if (!query || !query.trim()) throw new MemoryError('query must contain searchable text.');
    if (Buffer.byteLength(query, 'utf8') > MAX_QUERY_BYTES)
      throw new MemoryError('query exceeds the 16 KiB memory search limit.');
    const limit = bounded(input.limit ?? this.config.retrieval.limit, 1, 100, 'limit');
    const maxChars = bounded(input.max_chars ?? this.config.retrieval.max_chars, 256, 100_000, 'max_chars');

    const state = await this.withBarrierAsync(async () => {
      const loaded = this.loadState();
      const index = await this.ensureIndexAsync(loaded);
      try {
        return {
          records: index.search(query, loaded, {
            limit,
            maxChars,
            topic: input.topic,
            memoryType: input.memory_type,
            includeSuperseded: input.include_superseded,
            activeIds: loaded.activeIds,
          }),
        };
      } finally {
        index.close();
      }
    });
    return state.records;
  }

  /** Validates canonical records and verifies or rebuilds the cache. */
  public validate(): MemoryValidationReport {
    let index: SqliteIndex | undefined;
    try {
      this.assertEnabled();
      // Barrier-protected: validation must not observe a concurrent batch
      // mid-write, and its rebuild must not race a concurrent mutation.
      return this.withBarrier(() => this.validateLocked());
    } catch (error: unknown) {
      return {
        valid: false,
        records: 0,
        tombstones: 0,
        errors: [describe(error)],
        cache: { outcome: 'skipped', evidence: 'memory_validation_failed' },
      };
    } finally {
      index?.close();
    }
  }

  private validateLocked(): MemoryValidationReport {
    {
      let index: SqliteIndex | undefined;
      try {
        const state = this.loadState();
        const report = {
          valid: true,
          records: state.records.length,
          tombstones: state.tombstones.length,
          errors: [],
        };
        index = SqliteIndex.open(this.backend.memoryRoot);
        const hash = canonicalHash(state);
        const meta = index.meta();
        if (meta.canonicalHash === hash)
          return { ...report, cache: { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' } };
        index.rebuild(state);
        return { ...report, cache: { outcome: 'rebuilt', evidence: 'canonical_snapshot_rebuild_verified' } };
      } catch (error: unknown) {
        return {
          valid: false,
          records: 0,
          tombstones: 0,
          errors: [describe(error)],
          cache: { outcome: 'skipped', evidence: 'memory_validation_failed' },
        };
      } finally {
        index?.close();
      }
    }
  }

  /** Exports all records and tombstones as JSONL (one document per line). */
  public export(): string {
    return this.executeRead((state) => {
      const result = `${[...state.records, ...state.tombstones].map((item) => JSON.stringify(item)).join('\n')}\n`;
      if (Buffer.byteLength(result, 'utf8') > MAX_PAYLOAD_BYTES)
        throw new MemoryError('memory export exceeds the 64 MiB payload limit.');
      return result;
    });
  }

  /** Imports a JSONL payload; preview validates without writing. */
  public import(content: string, preview = false): ImportReport {
    if (Buffer.byteLength(content, 'utf8') > MAX_PAYLOAD_BYTES)
      throw new MemoryError('memory import exceeds the 64 MiB payload limit.');

    try {
      this.assertEnabled();
      // One barrier for validation AND mutation: preview and commit observe
      // the same serialized canonical state.
      return this.withBarrier(() => {
        const candidates = parseImportCandidates(content);
        const validated = this.validateImportBatch(candidates);
        if (preview)
          return {
            valid: true,
            records: validated.records.length,
            tombstones: validated.tombstones.length,
            errors: [],
          };

        const replacements: StorageReplacement[] = [
          ...validated.records.map((record) => ({
            path: this.backend.recordPath(record),
            bytes: this.backend.encode(record),
            exclusive: true,
          })),
          ...validated.tombstones.map((value) => ({
            path: this.backend.tombstonePath(value),
            bytes: this.backend.encode(value),
            exclusive: true,
          })),
        ];
        if (replacements.length) this.applyBatch(replacements);
        return { valid: true, records: validated.records.length, tombstones: validated.tombstones.length, errors: [] };
      });
    } catch (error: unknown) {
      if (preview) return { valid: false, records: 0, tombstones: 0, errors: [describe(error)] };
      if (error instanceof MemoryError || error instanceof MemoryConflictError) throw error;
      throw new MemoryError(describe(error));
    }
  }

  // -- internals ------------------------------------------------------------

  private validateImportBatch(candidates: Array<{ value: unknown; line: number }>): {
    records: MemoryRecord[];
    tombstones: MemoryTombstone[];
  } {
    const state = this.loadState();
    const records: MemoryRecord[] = [];
    const tombstones: MemoryTombstone[] = [];
    const ids = new Set([...state.records, ...state.tombstones].map((item) => item.id));

    for (const candidate of candidates) {
      const item = candidate.value;
      if (isTombstone(item)) {
        const result = memoryTombstoneSchema.safeParse(item);
        if (!result.success) throw new MemoryError(`Invalid memory tombstone at line ${candidate.line}.`);
        if (ids.has(result.data.id)) throw new MemoryConflictError(`Memory ID already exists: ${result.data.id}`);
        ids.add(result.data.id);
        tombstones.push(result.data);
        continue;
      }
      const recordId = readString(item, 'id');
      const context = `memory_import line ${candidate.line}${recordId ? ` record ${recordId}` : ''}`;
      this.backend.validateCompactness(readString(item, 'summary'), readStringOrNull(item, 'details'), context);
      const result = memoryRecordSchema.safeParse(item);
      if (!result.success) throw new MemoryError(`Invalid memory record at line ${candidate.line}.`);
      if (ids.has(result.data.id)) throw new MemoryConflictError(`Memory ID already exists: ${result.data.id}`);
      ids.add(result.data.id);
      records.push(result.data);
    }
    assertImportRelationships(state, records, tombstones);
    return { records, tombstones };
  }

  private executeRead<T>(operation: (state: ShardState) => T): T {
    return this.withBarrier(() => operation(this.loadState()));
  }

  private executeMutation<T>(operation: () => T): T {
    return this.withBarrier(() => {
      // Pre-validate canonical state, run the mutation, then re-validate and
      // resynchronize the disposable index (ported v1 execute() discipline).
      this.loadState();
      const result = operation();
      const state = this.loadState();
      // Post-mutation resync bypasses stale_policy: the cache must track the
      // write we just committed, whatever the read-time policy is.
      const index = SqliteIndex.open(this.backend.memoryRoot);
      try {
        index.rebuild(state);
      } finally {
        index.close();
      }
      return result;
    });
  }

  private withBarrier<T>(operation: () => T): T {
    this.assertEnabled();
    return withShardBarrier(this.backend.memoryRoot, this.scopeKey, operation);
  }

  private async withBarrierAsync<T>(operation: () => Promise<T>): Promise<T> {
    this.assertEnabled();
    return withShardBarrierAsync(this.backend.memoryRoot, this.scopeKey, operation);
  }

  /** Mirrors the v1 contract: disabled memory blocks every operation. */
  private assertEnabled(): void {
    if (!this.config.enabled)
      throw new MemoryError(
        'Memory operation requires skills.memory.enabled=true; the local Memory capability is disabled.',
      );
  }

  private loadState(): ShardState {
    return this.backend.loadState();
  }

  private applyBatch(replacements: readonly StorageReplacement[]): void {
    this.backend.applyBatch(replacements);
  }

  private async ensureIndexAsync(state: ShardState): Promise<SqliteIndex> {
    const index = SqliteIndex.open(this.backend.memoryRoot);
    if (!index.isStale(this.config.cache.max_age_ms, state)) return index;
    switch (this.config.cache.stale_policy) {
      case 'rebuild':
        index.rebuild(state);
        return index;
      case 'fail':
        throw new MemoryError('Memory cache is stale and cache.stale_policy is fail; run memory_validate.');
      case 'prompt': {
        if (this.onStaleCache === undefined || (await this.onStaleCache()) === true) {
          index.rebuild(state);
          return index;
        }
        throw new MemoryError('Memory cache is stale; rebuild declined by the host.');
      }
    }
  }

  private assertUniqueId(state: ShardState, id: string): void {
    if ([...state.records, ...state.tombstones].some((item) => item.id === id))
      throw new MemoryConflictError(`Memory ID already exists: ${id}`);
  }

  private requireActiveTarget(state: ShardState, targetId: string): void {
    if (!state.records.some((record) => record.id === targetId))
      throw new MemoryError(`Memory record not found: ${targetId}`);
    if (!state.activeIds.has(targetId)) throw new MemoryConflictError(`Memory record is not active: ${targetId}`);
  }
}

// -- helpers ---------------------------------------------------------------

function parseImportCandidates(content: string): Array<{ value: unknown; line: number }> {
  const candidates: Array<{ value: unknown; line: number }> = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      candidates.push({ value: JSON.parse(line) as unknown, line: index + 1 });
    } catch (error: unknown) {
      throw new MemoryError(`Invalid JSONL at line ${index + 1}: ${describe(error)}`);
    }
  }
  return candidates;
}

function isTombstone(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'target_id' in value;
}

function assertImportRelationships(state: ShardState, records: MemoryRecord[], tombstones: MemoryTombstone[]): void {
  const combined = [...state.records, ...records];
  const ids = new Set(combined.map((record) => record.id));
  for (const record of records)
    for (const target of record.supersedes)
      if (!ids.has(target)) throw new MemoryError(`Broken supersedes reference: ${target}`);
  for (const tombstone of tombstones)
    if (!ids.has(tombstone.target_id)) throw new MemoryError(`Broken tombstone reference: ${tombstone.target_id}`);
}

function assertUlid(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !isUlid(value)) throw new MemoryError(`${path} must be a Crockford ULID.`);
}

function bounded(value: unknown, low: number, high: number, name: string): number {
  if (!Number.isInteger(value) || (value as number) < low || (value as number) > high)
    throw new MemoryError(`${name} must be an integer from ${low} to ${high}.`);
  return value as number;
}

function readString(value: unknown, key: string): string {
  if (value === null || typeof value !== 'object' || !(key in value)) return '';
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : '';
}

function readStringOrNull(value: unknown, key: string): string | null | undefined {
  if (value === null || typeof value !== 'object' || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return field === null || typeof field === 'string' ? field : undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
