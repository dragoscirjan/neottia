import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { withShardBarrier } from '../barrier.js';
import type { MemoryConfig } from '../config.js';
import { MemoryConflictError, MemoryError } from '../errors.js';
import { canonicalHash, SqliteIndex } from '../index-sqlite.js';
import type { MemoryRecord, MemoryTombstone, RecordType } from '../schemas.js';
import { createSecretScanner, type SecretScanner } from '../security.js';
import {
  makeRecord as makeRecordHelper,
  makeTombstone as makeTombstoneHelper,
  validateCompactness as validateCompactnessHelper,
  validateRecord as validateRecordHelper,
  validateTombstone as validateTombstoneHelper,
  type RecordHelperDeps,
} from './record-helpers.js';
import type {
  BackendSearchOptions,
  CacheValidation,
  NamespaceScope,
  ShardState,
  StorageBackend,
  StorageLimits,
  StorageReplacement,
} from './types.js';

/**
 * Filesystem backend, ported from the harnessctl-v2 memory implementation:
 * canonical YAML files under per-type folders, atomic batch writes with
 * rollback, strict path/symlink/resource safety. The SQLite index is a
 * sibling concern (see index/sqlite.ts) and never the canonical source.
 */

export const RECORD_FOLDERS: Readonly<Record<RecordType, string>> = {
  fact: 'facts',
  decision: 'decisions',
  event: 'events',
  lesson: 'lessons',
};

export interface FilesystemBackendOptions {
  readonly config: MemoryConfig;
  readonly cwd: string;
  /** Host hook for stale_policy 'prompt' (see MemoryStoreOptions). */
  readonly onStaleCache?: () => boolean | Promise<boolean>;
}

export class FilesystemBackend implements StorageBackend {
  private readonly root: string;
  private readonly limits: StorageLimits;
  private readonly scanner: SecretScanner;
  private readonly scope: NamespaceScope;
  private readonly defaultTopic: string;
  private readonly helperDeps: RecordHelperDeps;
  private readonly cacheMaxAgeMs: number;
  private readonly stalePolicy: 'prompt' | 'rebuild' | 'fail';
  private readonly onStaleCache?: () => boolean | Promise<boolean>;

  public constructor(options: FilesystemBackendOptions) {
    this.root = resolve(options.cwd, options.config.root);
    this.cacheMaxAgeMs = options.config.cache.max_age_ms;
    this.stalePolicy = options.config.cache.stale_policy;
    this.onStaleCache = options.onStaleCache;
    this.limits = {
      maxFileBytes: options.config.security.limits.max_file_bytes,
      maxFiles: options.config.security.limits.max_files,
      maxTotalBytes: options.config.security.limits.max_total_bytes,
    };
    this.scanner = createSecretScanner({
      customPatterns: options.config.security.secret_patterns,
      entropyHeuristic: options.config.security.entropy_heuristic,
    });
    this.scope = {
      organizationId: options.config.namespace.organization_id,
      projectId: options.config.namespace.project_id,
      scope: options.config.namespace.scope,
    };
    this.defaultTopic = options.config.namespace.default_topic;
    this.helperDeps = { scope: this.scope, scanner: this.scanner, defaultTopic: this.defaultTopic };
  }

  public get memoryRoot(): string {
    return this.root;
  }

  public get namespaceScope(): NamespaceScope {
    return this.scope;
  }

  /** {@inheritdoc StorageBackend.loadState} */
  public async loadState(): Promise<ShardState> {
    const records: MemoryRecord[] = [];
    const tombstones: MemoryTombstone[] = [];
    const ids = new Set<string>();
    const digests: string[] = [];
    let files = 0;
    let bytes = 0;
    const track = (path: string): void => {
      digests.push(`${relative(this.root, path)}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
    };

    for (const [recordType, folder] of Object.entries(RECORD_FOLDERS) as Array<[RecordType, string]>) {
      for (const path of this.yamlFiles(join(this.root, folder))) {
        ({ files, bytes } = this.trackUsage(path, files, bytes));
        track(path);
        const record = this.parseCanonical(path);
        const validated = validateRecordHelper(record, this.helperDeps);
        if (validated.record_type !== recordType)
          throw new MemoryError(`Record type does not match folder: ${relative(this.root, path)}`);
        if (ids.has(validated.id)) throw new MemoryError(`Duplicate memory ID: ${validated.id}`);
        ids.add(validated.id);
        records.push(validated);
      }
    }

    for (const path of this.yamlFiles(join(this.root, 'tombstones'))) {
      ({ files, bytes } = this.trackUsage(path, files, bytes));
      track(path);
      const tombstone = this.parseCanonical(path);
      const validatedTombstone = validateTombstoneHelper(tombstone, this.helperDeps);
      if (ids.has(validatedTombstone.id)) throw new MemoryError(`Duplicate memory ID: ${validatedTombstone.id}`);
      ids.add(validatedTombstone.id);
      tombstones.push(validatedTombstone);
    }

    const recordIds = new Set(records.map((record) => record.id));
    for (const record of records)
      for (const target of record.supersedes)
        if (!recordIds.has(target)) throw new MemoryError(`Broken supersedes reference: ${target}`);
    for (const tombstone of tombstones)
      if (!recordIds.has(tombstone.target_id))
        throw new MemoryError(`Broken tombstone reference: ${tombstone.target_id}`);
    assertAcyclic(records);

    records.sort(newestFirst);
    tombstones.sort((left, right) => newestFirst(left, right));
    const inactive = new Set(records.flatMap((record) => record.supersedes));
    tombstones.forEach((item) => inactive.add(item.target_id));
    const contentHash = createHash('sha256').update(digests.sort().join('\n')).digest('hex');
    return {
      records,
      tombstones,
      activeIds: new Set(records.filter((record) => !inactive.has(record.id)).map((record) => record.id)),
      contentHash,
    };
  }

  /** {@inheritdoc StorageBackend.applyBatch} */
  public async applyBatch(replacements: readonly StorageReplacement[]): Promise<void> {
    this.applyBatchSync(replacements);
  }

  private applyBatchSync(replacements: readonly StorageReplacement[]): void {
    if (replacements.length > this.limits.maxFiles) throw new MemoryError('Memory batch path limit exceeded.');
    const ordered = [...replacements].sort((left, right) => left.path.localeCompare(right.path));
    const before = new Map<string, Uint8Array | undefined>();
    const seen = new Set<string>();
    let retained = 0;

    for (const replacement of ordered) {
      const absolute = this.managedPath(replacement.path);
      const key = replacement.path.normalize('NFKC').toLowerCase();
      if (seen.has(key)) throw new MemoryError('Memory batch contains duplicate paths.');
      seen.add(key);
      const previous = existsSync(absolute) ? this.readRegular(absolute) : undefined;
      if (replacement.exclusive && previous)
        throw new MemoryConflictError(`Memory path already exists: ${replacement.path}`);
      retained += previous?.byteLength ?? 0;
      if (retained > this.limits.maxTotalBytes) throw new MemoryError('Memory batch before-image limit exceeded.');
      before.set(replacement.path, previous);
    }

    const applied: StorageReplacement[] = [];
    try {
      for (const replacement of ordered) {
        this.publish(replacement.path, replacement.bytes);
        applied.push(replacement);
      }
    } catch (error: unknown) {
      let rollbackFailed = false;
      for (const replacement of applied.reverse()) {
        try {
          this.publish(replacement.path, before.get(replacement.path));
        } catch {
          rollbackFailed = true;
        }
      }
      if (rollbackFailed) throw new MemoryError('Memory batch rollback failed; canonical state may be inconsistent.');
      throw error;
    }
  }

  /** {@inheritdoc StorageBackend.search} — BM25 through the SQLite index. */
  public async search(state: ShardState, query: string, options: BackendSearchOptions): Promise<MemoryRecord[]> {
    const index = await this.ensureIndex(state);
    try {
      return index.search(query, state, options);
    } finally {
      index.close();
    }
  }

  /** {@inheritdoc StorageBackend.withLock} — shard-scoped directory lock. */
  public async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withShardBarrier(this.root, this.scopeKey, operation);
  }

  /** {@inheritdoc StorageBackend.checkOrRebuildCache} */
  public async checkOrRebuildCache(state: ShardState): Promise<CacheValidation> {
    // Fresh connection per call: the index file can be replaced externally
    // (tests, manual deletion), and an open handle would read stale pages.
    const index = SqliteIndex.open(this.root);
    try {
      if (index.meta().canonicalHash === canonicalHash(state))
        return { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' };
      index.rebuild(state);
      return { outcome: 'rebuilt', evidence: 'canonical_snapshot_rebuild_verified' };
    } finally {
      index.close();
    }
  }

  /** {@inheritdoc StorageBackend.resetCache} */
  public async resetCache(): Promise<void> {
    SqliteIndex.destroy(this.root);
  }

  /** {@inheritdoc StorageBackend.close} — the index opens per operation. */
  public async close(): Promise<void> {
    await Promise.resolve();
  }

  /** Opens a fresh index connection and resolves staleness per policy. */
  private async ensureIndex(state: ShardState): Promise<SqliteIndex> {
    const index = SqliteIndex.open(this.root);
    try {
      if (!index.isStale(this.cacheMaxAgeMs, state)) return index;
      await this.resolveStaleness(index, state);
      return index;
    } catch (error: unknown) {
      // A failed staleness resolution (fail policy, declined prompt) must not
      // leak the opened handle.
      index.close();
      throw error;
    }
  }

  private async resolveStaleness(index: SqliteIndex, state: ShardState): Promise<void> {
    switch (this.stalePolicy) {
      case 'rebuild':
        index.rebuild(state);
        return;
      case 'fail':
        throw new MemoryError('Memory cache is stale and cache.stale_policy is fail; run memory_validate.');
      case 'prompt': {
        if (this.onStaleCache === undefined || (await this.onStaleCache()) === true) {
          index.rebuild(state);
          return;
        }
        throw new MemoryError('Memory cache is stale; rebuild declined by the host.');
      }
    }
  }

  /** Shard lock identity derived from the namespace config. */
  public get scopeKey(): string {
    return `${this.scope.organizationId}--${this.scope.projectId}--${this.scope.scope}`;
  }

  /** Creates a validated record object with a fresh ULID and scope from config. */
  public makeRecord(input: MemoryRecordInput, supersedes: string[], now: () => Date = () => new Date()): MemoryRecord {
    return makeRecordHelper(this.helperDeps, input, supersedes, now);
  }

  /** Builds the canonical file path for a record from its record type. */
  public recordPath(record: MemoryRecord): string {
    return `${RECORD_FOLDERS[record.record_type]}/${record.id}.yaml`;
  }

  /** Tombstone file path inside the canonical tree. */
  public tombstonePath(tombstone: MemoryTombstone): string {
    return `tombstones/${tombstone.id}.yaml`;
  }

  /** Validates and returns a tombstone object for a target record. */
  public makeTombstone(
    targetId: string,
    reason: string,
    source: MemoryTombstone['source'],
    createdBy: string,
    now: () => Date = () => new Date(),
  ): MemoryTombstone {
    return makeTombstoneHelper(this.helperDeps, targetId, reason, source, createdBy, now);
  }

  /** Validates mutation compactness for store/supersede/import inputs. */
  public validateCompactness(summary: string, details: string | null | undefined, context: string): void {
    validateCompactnessHelper(summary, details, context);
  }

  public encode(value: MemoryRecord | MemoryTombstone): Uint8Array {
    return Buffer.from(stringify(value, { lineWidth: 0 }), 'utf8');
  }

  private yamlFiles(directory: string): string[] {
    if (!existsSync(directory)) return [];
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new MemoryError(`Unsafe memory directory: ${directory}`);
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.name.endsWith('.yaml'))
      .map((entry) => {
        if (!entry.isFile() || entry.isSymbolicLink())
          throw new MemoryError(`Unsafe memory file: ${join(directory, entry.name)}`);
        return join(directory, entry.name);
      })
      .sort();
  }

  private trackUsage(path: string, files: number, bytes: number): { files: number; bytes: number } {
    const size = lstatSync(path).size;
    if (size > this.limits.maxFileBytes) throw new MemoryError(`Memory file exceeds limit: ${path}`);
    const result = { files: files + 1, bytes: bytes + size };
    if (result.files > this.limits.maxFiles) throw new MemoryError('Memory file limit exceeded.');
    if (result.bytes > this.limits.maxTotalBytes) throw new MemoryError('Aggregate memory byte limit exceeded.');
    return result;
  }

  private parseCanonical(path: string): unknown {
    const bytes = readFileSync(path);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new MemoryError(`Malformed UTF-8 memory YAML: ${path}`);
    }
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length || document.warnings.length)
      throw new MemoryError(
        `Malformed memory YAML ${path}: ${document.errors[0]?.message ?? document.warnings[0]?.message}`,
      );
    try {
      return document.toJS({ maxAliasCount: 0 });
    } catch (error: unknown) {
      throw new MemoryError(`Unsafe memory YAML ${path}: ${describe(error)}`);
    }
  }

  private publish(path: string, bytes: Uint8Array | undefined): void {
    const absolute = this.managedPath(path);
    this.ensureSafeDirectories(dirname(relative(this.root, absolute)).split(sep).join('/'));
    if (!bytes) {
      if (existsSync(absolute)) rmSync(absolute);
      syncDirectory(dirname(absolute));
      return;
    }
    const temporary = join(dirname(absolute), `.${randomToken()}.tmp`);
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, absolute);
      syncDirectory(dirname(absolute));
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporary, { force: true });
    }
  }

  private managedPath(path: string): string {
    const safe = safeProjectPath(path);
    const absolute = resolve(this.root, safe);
    const nested = relative(this.root, absolute);
    if (!nested || isAbsolute(nested) || nested === '..' || nested.startsWith(`..${sep}`))
      throw new MemoryError('Memory path escapes project root.');
    this.assertSafeRoot(dirname(safe).split(sep).join('/'));
    return absolute;
  }

  private assertSafeRoot(path: string): void {
    let current = resolve(this.root);
    for (const component of path.split(/[\\/]/u).filter(Boolean)) {
      current = join(current, component);
      if (!existsSync(current)) return;
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new MemoryError(`Unsafe memory path ancestor: ${path}`);
    }
  }

  private ensureSafeDirectories(path: string): void {
    let current = resolve(this.root);
    for (const component of path.split('/').filter(Boolean)) {
      current = join(current, component);
      if (existsSync(current)) {
        const stat = lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new MemoryError('Unsafe memory directory ancestor.');
      } else mkdirSync(current, { mode: 0o700 });
    }
  }

  private readRegular(path: string): Uint8Array {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new MemoryError('Managed memory path is not a regular file.');
    return readFileSync(path);
  }
}

export type MemoryRecordInput = Omit<
  MemoryRecord,
  | 'schema_version'
  | 'id'
  | 'organization_id'
  | 'project_id'
  | 'created_at'
  | 'status'
  | 'supersedes'
  | 'topic'
  | 'details'
  | 'tags'
> & {
  topic?: string;
  details?: string | null;
  tags?: string[];
};

function assertAcyclic(records: MemoryRecord[]): void {
  const edges = new Map(records.map((record) => [record.id, record.supersedes]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new MemoryError(`Cyclic supersession at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of edges.get(id) ?? []) visit(target);
    visiting.delete(id);
    visited.add(id);
  };
  records.forEach((record) => visit(record.id));
}

export function safeProjectPath(value: string): string {
  if (
    !value ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value) ||
    value.split(/[\\/]/u).some((part) => !part || part === '.' || part === '..')
  )
    throw new MemoryError('Memory path escapes project root.');
  return value;
}

export { searchableText } from './record-helpers.js';

export function newestFirst(left: { created_at: string }, right: { created_at: string }): number {
  return right.created_at.localeCompare(left.created_at);
}

function randomToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function syncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r');
    fsyncSync(descriptor);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(code ?? '')) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
