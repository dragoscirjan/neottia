import { FilesystemBackend } from './backend/filesystem.js';
import { PostgresBackend } from './backend/postgres.js';
import { assertAcyclic } from './backend/record-helpers.js';
import type { BackendSearchOptions, ShardState, StorageBackend, StorageReplacement } from './backend/types.js';
import type { MemoryConfig } from './config.js';
import { MemoryConflictError, MemoryError } from './errors.js';
import { isUlid } from './identities.js';
import {
  memoryRecordSchema,
  memoryTombstoneSchema,
  type MemoryRecord,
  type MemorySource,
  type MemoryTombstone,
} from './schemas.js';
import {
  MEMORY_TOOL_LIMITS,
  type ImportReport,
  type MemoryValidationReport,
  type StoreMemoryInput,
} from './tool-contracts.js';

export type { ImportReport, MemoryValidationReport, StoreMemoryInput } from './tool-contracts.js';

/**
 * MemoryStore: the facade behind the memory_* tool surface. Operations run
 * inside a backend-scoped lock (file barrier for the filesystem backend,
 * advisory locks for Postgres); mutations re-validate canonical state and
 * resynchronize the backend search index afterwards. Ported from the
 * harnessctl-v2 memory implementation; backends are pluggable (issue #6).
 */

export interface SearchMemoryInput {
  query?: string;
  topic?: string;
  memory_type?: string;
  limit?: number;
  max_chars?: number;
  include_superseded?: boolean;
}

export interface MemoryStoreOptions {
  readonly config: MemoryConfig;
  readonly cwd: string;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
  /** Host hook for stale_policy 'prompt' (extensions can prompt the user). */
  readonly onStaleCache?: () => boolean | Promise<boolean>;
}

export class MemoryStore {
  private readonly backend: StorageBackend;
  private readonly config: MemoryConfig;
  private readonly now: () => Date;

  public constructor(options: MemoryStoreOptions) {
    this.config = options.config;
    this.now = options.now ?? (() => new Date());
    this.backend = createBackend(options);
  }

  /** Builds a store from a resolved config shard. */
  public static fromConfig(config: MemoryConfig, cwd: string, options: Partial<MemoryStoreOptions> = {}): MemoryStore {
    return new MemoryStore({ ...options, config, cwd });
  }

  /** Releases backend resources (e.g. Postgres pool connections). */
  public async close(): Promise<void> {
    await this.backend.close();
  }

  /** Lock identity of the namespace shard this store writes to. */
  public get scopeKey(): string {
    const namespace = this.config.namespace;
    return `${namespace.organization_id}--${namespace.project_id}--${namespace.scope}`;
  }

  /** Stores a new active memory record. */
  public async store(input: StoreMemoryInput): Promise<MemoryRecord> {
    this.backend.validateCompactness(input.summary, input.details, 'memory_store');
    return this.executeMutation(() => this.writeRecord(this.backend.makeRecord(input, [], this.now)));
  }

  /** Stores a replacement record that supersedes an active target. */
  public async supersede(targetId: string, input: StoreMemoryInput): Promise<MemoryRecord> {
    assertUlid(targetId, 'target_id');
    this.backend.validateCompactness(input.summary, input.details, 'memory_supersede');
    return this.executeMutation(async () => {
      this.requireActiveTarget(await this.loadState(), targetId);
      return this.writeRecord(this.backend.makeRecord(input, [targetId], this.now));
    });
  }

  /** Tombstones an active record; canonical data is never deleted. */
  public async delete(
    targetId: string,
    reason: string,
    source: MemorySource,
    createdBy: string,
  ): Promise<MemoryTombstone> {
    assertUlid(targetId, 'target_id');
    return this.executeMutation(async () => {
      const state = await this.loadState();
      this.requireActiveTarget(state, targetId);
      const tombstone = this.backend.makeTombstone(targetId, reason, source, createdBy, this.now);
      this.assertUniqueId(state, tombstone.id);
      await this.applyBatch([
        { path: this.backend.tombstonePath(tombstone), bytes: this.backend.encode(tombstone), exclusive: true },
      ]);
      return tombstone;
    });
  }

  /** Fetches one record or tombstone by ULID. */
  public async get(id: string): Promise<MemoryRecord | MemoryTombstone> {
    assertUlid(id, 'id');
    return this.executeRead((state) => {
      const result = [...state.records, ...state.tombstones].find((item) => item.id === id);
      if (!result) throw new MemoryError(`Memory record not found: ${id}`);
      return result;
    });
  }

  /** Lists records, newest first, with optional topic/type filters. */
  public async list(input: SearchMemoryInput = {}): Promise<MemoryRecord[]> {
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

  /** BM25-ranked search through the backend index. */
  public async search(input: SearchMemoryInput = {}): Promise<MemoryRecord[]> {
    const query = input.query;
    if (!query || !query.trim()) throw new MemoryError('query must contain searchable text.');
    if (Buffer.byteLength(query, 'utf8') > MEMORY_TOOL_LIMITS.queryBytes)
      throw new MemoryError('query exceeds the 16 KiB memory search limit.');
    const limit = bounded(input.limit ?? this.config.retrieval.limit, 1, 100, 'limit');
    const maxChars = bounded(input.max_chars ?? this.config.retrieval.max_chars, 256, 100_000, 'max_chars');

    return this.withBarrier(async () => {
      const state = await this.loadState();
      const options: BackendSearchOptions = {
        limit,
        maxChars,
        topic: input.topic,
        memoryType: input.memory_type,
        includeSuperseded: input.include_superseded ?? this.config.retrieval.include_superseded,
        activeIds: state.activeIds,
      };
      return this.backend.search(state, query, options);
    });
  }

  /** Validates canonical records and verifies or rebuilds the search index. */
  public async validate(): Promise<MemoryValidationReport> {
    try {
      this.assertEnabled();
      return await this.withBarrier(async () => {
        const state = await this.loadState();
        const report = {
          valid: true,
          records: state.records.length,
          tombstones: state.tombstones.length,
          errors: [] as string[],
        };
        const cache = await this.backend.checkOrRebuildCache(state);
        return { ...report, cache };
      });
    } catch (error: unknown) {
      return invalidMemoryValidationReport(error);
    }
  }

  /** Exports all records and tombstones as JSONL (one document per line). */
  public async export(): Promise<string> {
    return this.executeRead((state) => {
      const result = `${[...state.records, ...state.tombstones].map((item) => JSON.stringify(item)).join('\n')}\n`;
      if (Buffer.byteLength(result, 'utf8') > MEMORY_TOOL_LIMITS.exportBytes)
        throw new MemoryError('memory export exceeds the 64 MiB payload limit.');
      return result;
    });
  }

  /** Imports a JSONL payload; preview validates without writing. */
  public async import(content: string, preview = false): Promise<ImportReport> {
    if (Buffer.byteLength(content, 'utf8') > MEMORY_TOOL_LIMITS.importBytes)
      throw new MemoryError('memory import exceeds the 64 MiB payload limit.');

    try {
      this.assertEnabled();
      return await this.withBarrier(async () => {
        const candidates = parseImportCandidates(content);
        const validated = this.validateImportBatch(candidates, await this.loadState());
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
        if (replacements.length) await this.applyBatch(replacements);
        // Imports bypass executeMutation because preview shares this path;
        // synchronize the disposable cache only after canonical publication.
        if (!replacements.length)
          return {
            valid: true,
            records: validated.records.length,
            tombstones: validated.tombstones.length,
            errors: [],
          };
        try {
          await this.backend.checkOrRebuildCache(await this.loadState());
        } catch (error: unknown) {
          return {
            valid: true,
            records: validated.records.length,
            tombstones: validated.tombstones.length,
            errors: [],
            warnings: [`Import committed; cache maintenance failed: ${describe(error)}`],
          };
        }
        return { valid: true, records: validated.records.length, tombstones: validated.tombstones.length, errors: [] };
      });
    } catch (error: unknown) {
      if (preview) return { valid: false, records: 0, tombstones: 0, errors: [describe(error)] };
      if (error instanceof MemoryError || error instanceof MemoryConflictError) throw error;
      throw new MemoryError(describe(error));
    }
  }

  // -- internals ------------------------------------------------------------

  /** Exclusively writes one validated record; rejects duplicate identities. */
  private async writeRecord(record: MemoryRecord): Promise<MemoryRecord> {
    this.assertUniqueId(await this.loadState(), record.id);
    await this.applyBatch([
      { path: this.backend.recordPath(record), bytes: this.backend.encode(record), exclusive: true },
    ]);
    return record;
  }

  private validateImportBatch(
    candidates: Array<{ value: unknown; line: number }>,
    state: ShardState,
  ): { records: MemoryRecord[]; tombstones: MemoryTombstone[] } {
    const records: MemoryRecord[] = [];
    const tombstones: MemoryTombstone[] = [];
    const ids = new Set([...state.records, ...state.tombstones].map((item) => item.id));

    for (const candidate of candidates) {
      const item = candidate.value;
      if (isTombstone(item)) {
        const result = memoryTombstoneSchema.safeParse(item);
        if (!result.success) throw new MemoryError(`Invalid memory tombstone at line ${candidate.line}.`);
        const tombstone = this.backend.validateTombstone(result.data, `memory tombstone at line ${candidate.line}`);
        if (ids.has(tombstone.id)) throw new MemoryConflictError(`Memory ID already exists: ${tombstone.id}`);
        ids.add(tombstone.id);
        tombstones.push(tombstone);
        continue;
      }
      this.backend.validateCompactness(
        readString(item, 'summary'),
        readStringOrNull(item, 'details'),
        `memory_import line ${candidate.line}${readString(item, 'id') ? ` record ${readString(item, 'id')}` : ''}`,
      );
      const result = memoryRecordSchema.safeParse(item);
      if (!result.success) throw new MemoryError(`Invalid memory record at line ${candidate.line}.`);
      const record = this.backend.validateRecord(result.data, `memory record at line ${candidate.line}`);
      if (ids.has(record.id)) throw new MemoryConflictError(`Memory ID already exists: ${record.id}`);
      ids.add(record.id);
      records.push(record);
    }
    assertImportRelationships(state, records, tombstones);
    assertAcyclic([...state.records, ...records]);
    return { records, tombstones };
  }

  private async executeRead<T>(operation: (state: ShardState) => T): Promise<T> {
    return this.withBarrier(async () => operation(await this.loadState()));
  }

  private async executeMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.withBarrier(async () => {
      // Pre-validate canonical state, run the mutation, then re-validate and
      // resynchronize the backend search index.
      await this.loadState();
      const result = await operation();
      const state = await this.loadState();
      await this.backend.checkOrRebuildCache(state);
      return result;
    });
  }

  private withBarrier<T>(operation: () => Promise<T>): Promise<T> {
    this.assertEnabled();
    return this.backend.withLock(operation);
  }

  private loadState(): Promise<ShardState> {
    return this.backend.loadState();
  }

  private applyBatch(replacements: readonly StorageReplacement[]): Promise<void> {
    return this.backend.applyBatch(replacements);
  }

  private assertEnabled(): void {
    if (!this.config.enabled)
      throw new MemoryError(
        'Memory operation requires skills.memory.enabled=true; the local Memory capability is disabled.',
      );
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

// -- backend factory --------------------------------------------------------

function createBackend(options: MemoryStoreOptions): StorageBackend {
  switch (options.config.backend) {
    case 'filesystem':
      return new FilesystemBackend({
        config: options.config,
        cwd: options.cwd,
        onStaleCache: options.onStaleCache,
      });
    case 'postgres':
      return new PostgresBackend({ config: options.config, cwd: options.cwd });
    default: {
      const exhausted: never = options.config.backend;
      throw new MemoryError(`Unsupported memory backend: ${String(exhausted)}`);
    }
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

  assertSingleRetirement(state, records, tombstones);
}

/** Ensures every target has exactly one possible transition out of active state. */
function assertSingleRetirement(
  state: ShardState,
  importedRecords: readonly MemoryRecord[],
  importedTombstones: readonly MemoryTombstone[],
): void {
  type Retirement = { kind: 'supersession' | 'tombstone'; imported: boolean };
  const retirements = new Map<string, Retirement>();
  const retire = (target: string, retirement: Retirement): void => {
    const previous = retirements.get(target);
    if (!previous) {
      retirements.set(target, retirement);
      return;
    }
    if (previous.kind !== retirement.kind)
      throw new MemoryConflictError(`Memory record cannot be both superseded and tombstoned: ${target}`);
    if (retirement.imported && !previous.imported)
      throw new MemoryConflictError(`Memory record is already inactive in canonical state: ${target}`);
    throw new MemoryConflictError(`Memory record has multiple ${retirement.kind} retirements: ${target}`);
  };

  for (const record of state.records)
    for (const target of record.supersedes) retire(target, { kind: 'supersession', imported: false });
  for (const tombstone of state.tombstones) retire(tombstone.target_id, { kind: 'tombstone', imported: false });
  for (const record of importedRecords)
    for (const target of record.supersedes) retire(target, { kind: 'supersession', imported: true });
  for (const tombstone of importedTombstones) retire(tombstone.target_id, { kind: 'tombstone', imported: true });
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

function invalidMemoryValidationReport(error: unknown): MemoryValidationReport {
  return {
    valid: false,
    records: 0,
    tombstones: 0,
    errors: [describe(error)],
    cache: { outcome: 'skipped', evidence: 'memory_validation_failed' },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
