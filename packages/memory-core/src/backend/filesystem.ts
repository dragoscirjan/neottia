import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  DEFAULT_STORE_LIMITS,
  RepositoryStoreError,
  StaleRevisionError,
  applyCanonicalBatch,
  readManagedFile,
  resolveManagedPath,
  scanManagedFiles,
  resolveManagedRoot,
  withRepositoryLease,
  type ManagedRoot,
  type ManagedRootOptions,
  type RepositoryLease,
} from '@neottia/repository-store';
import { parseDocument, stringify } from 'yaml';
import type { MemoryConfig } from '../config.js';
import { MemoryConflictError, MemoryError, MemoryLockError } from '../errors.js';
import {
  captureDirectoryIdentities as captureDirectoryIdentityChain,
  isFilesystemErrorCode as isCode,
  noFollowFlag,
  revalidateDirectoryIdentities as revalidateDirectoryIdentityChain,
  sameFilesystemIdentity as sameIdentity,
  type DirectoryIdentity,
} from '../filesystem-safety.js';
import { isUlid } from '../identities.js';
import { SqliteIndex } from '../index-sqlite.js';
import type { MemoryRecord, MemoryTombstone, RecordType } from '../schemas.js';
import { createSecretScanner, type SecretScanner } from '../security.js';
import {
  makeRecord as makeRecordHelper,
  makeTombstone as makeTombstoneHelper,
  validateCompactness as validateCompactnessHelper,
  validateRecord as validateRecordHelper,
  validateTombstone as validateTombstoneHelper,
  assertAcyclic,
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

export interface FilesystemOperations {
  readonly renameSync: typeof renameSync;
  readonly syncDirectory: (path: string) => void;
}

export interface FilesystemBackendOptions {
  readonly config: MemoryConfig;
  readonly cwd: string;
  /** Host hook for stale_policy 'prompt' (see MemoryStoreOptions). */
  readonly onStaleCache?: () => boolean | Promise<boolean>;
  /** Advanced injection hook for testing atomic publication failures. */
  readonly filesystemOps?: Partial<FilesystemOperations>;
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
  private readonly filesystemOps: FilesystemOperations;
  private readonly usesInjectedFilesystemOperations: boolean;
  private repositoryRoot?: Promise<ManagedRoot>;
  private readonly repositoryRootOptions: ManagedRootOptions;
  private readonly repositoryLease = new AsyncLocalStorage<RepositoryLease>();

  public constructor(options: FilesystemBackendOptions) {
    this.root = resolve(options.cwd, options.config.root);
    assertSafeMemoryRoot(this.root);
    this.cacheMaxAgeMs = options.config.cache.max_age_ms;
    this.stalePolicy = options.config.cache.stale_policy;
    this.onStaleCache = options.onStaleCache;
    this.filesystemOps = { ...DEFAULT_FILESYSTEM_OPERATIONS, ...options.filesystemOps };
    this.usesInjectedFilesystemOperations = options.filesystemOps !== undefined;
    this.limits = {
      maxFileBytes: options.config.security.limits.max_file_bytes,
      maxFiles: options.config.security.limits.max_files,
      maxTotalBytes: options.config.security.limits.max_total_bytes,
    };
    const absoluteConfiguredRoot = isAbsolute(options.config.root);
    this.repositoryRootOptions = {
      authorityRoot: absoluteConfiguredRoot ? this.root : resolve(options.cwd),
      ...(absoluteConfiguredRoot ? {} : { managedPath: options.config.root.split(sep).join('/') }),
      limits: {
        ...DEFAULT_STORE_LIMITS,
        maxFileBytes: this.limits.maxFileBytes,
        maxFiles: this.limits.maxFiles,
        maxTotalBytes: this.limits.maxTotalBytes,
        maxBatchPaths: this.limits.maxFiles,
        maxBeforeImageBytes: this.limits.maxTotalBytes,
        maxTemporaryBytes: this.limits.maxTotalBytes,
      },
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
    // Public low-level callers retain their historical no-wrapper behavior,
    // while every read now first acquires the repository authority and recovers.
    if (this.repositoryLease.getStore() === undefined) return this.withRepositoryAccess(async () => this.loadState());
    const records: MemoryRecord[] = [];
    const tombstones: MemoryTombstone[] = [];
    const ids = new Set<string>();
    const digests: string[] = [];
    let files = 0;
    let bytes = 0;
    const track = (path: string, content: Uint8Array): void => {
      digests.push(`${relative(this.root, path)}:${createHash('sha256').update(content).digest('hex')}`);
    };

    for (const [recordType, folder] of Object.entries(RECORD_FOLDERS) as Array<[RecordType, string]>) {
      for (const { path, content } of await this.repositoryYamlFiles(folder)) {
        ({ files, bytes } = this.trackUsage(path, content.byteLength, files, bytes));
        track(path, content);
        const record = this.parseCanonical(content, path);
        const validated = validateRecordHelper(record, this.helperDeps);
        this.assertFilenameIdentity(path, validated.id);
        if (validated.record_type !== recordType)
          throw new MemoryError(`Record type does not match folder: ${relative(this.root, path)}`);
        if (ids.has(validated.id)) throw new MemoryError(`Duplicate memory ID: ${validated.id}`);
        ids.add(validated.id);
        records.push(validated);
      }
    }

    for (const { path, content } of await this.repositoryYamlFiles('tombstones')) {
      ({ files, bytes } = this.trackUsage(path, content.byteLength, files, bytes));
      track(path, content);
      const tombstone = this.parseCanonical(content, path);
      const validatedTombstone = validateTombstoneHelper(tombstone, this.helperDeps);
      this.assertFilenameIdentity(path, validatedTombstone.id);
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
    if (this.usesInjectedFilesystemOperations) {
      // Preserve the documented test seam while production publication uses
      // repository-store's durable journal implementation.
      return this.withRepositoryAccess(async () => this.applyBatchSync(replacements));
    }
    return this.withRepositoryAccess(async (root, lease) => {
      if (replacements.length > this.limits.maxFiles) throw new MemoryError('Memory batch path limit exceeded.');
      const operations = [];
      for (const replacement of replacements) {
        if (replacement.bytes) this.validateReplacementIdentity(replacement.path, replacement.bytes);
        const path = resolveManagedPath(root, replacement.path);
        let current;
        try {
          current = await readManagedFile(root, lease, path);
        } catch (error: unknown) {
          if (!isCode(error, 'ENOENT')) throw error;
        }
        if (replacement.exclusive && current !== undefined)
          throw new MemoryConflictError(`Memory path already exists: ${replacement.path}`);
        if (replacement.bytes === undefined) {
          if (current !== undefined) operations.push({ kind: 'remove' as const, path, expected: current.revision });
        } else {
          operations.push({
            kind: 'write' as const,
            path,
            bytes: replacement.bytes,
            expected: current?.revision ?? ('absent' as const),
          });
        }
      }
      try {
        await applyCanonicalBatch(root, lease, operations, {
          inventory: [...Object.values(RECORD_FOLDERS), 'tombstones'].map((folder) => resolveManagedPath(root, folder)),
        });
      } catch (error: unknown) {
        if (error instanceof StaleRevisionError)
          throw new MemoryConflictError(`Memory canonical revision changed during mutation: ${error.message}`);
        throw error;
      }
    });
  }

  private applyBatchSync(replacements: readonly StorageReplacement[]): void {
    if (replacements.length > this.limits.maxFiles) throw new MemoryError('Memory batch path limit exceeded.');
    const ordered = [...replacements].sort((left, right) => left.path.localeCompare(right.path));
    const before = new Map<string, Uint8Array | undefined>();
    const seen = new Set<string>();
    let resultingFiles = 0;
    let resultingBytes = 0;
    for (const folder of [...Object.values(RECORD_FOLDERS), 'tombstones']) {
      for (const path of this.yamlFiles(join(this.root, folder))) {
        resultingFiles += 1;
        resultingBytes += this.regularSize(path);
      }
    }

    for (const replacement of ordered) {
      const absolute = this.managedPath(replacement.path);
      if (replacement.bytes) this.validateReplacementIdentity(replacement.path, replacement.bytes);
      const key = replacement.path.normalize('NFKC').toLowerCase();
      if (seen.has(key)) throw new MemoryError('Memory batch contains duplicate paths.');
      seen.add(key);
      const previous = this.readRegularIfExists(absolute);
      if (replacement.exclusive && previous)
        throw new MemoryConflictError(`Memory path already exists: ${replacement.path}`);
      const nextBytes = replacement.bytes?.byteLength ?? 0;
      if (nextBytes > this.limits.maxFileBytes) throw new MemoryError(`Memory file exceeds limit: ${replacement.path}`);
      resultingFiles += previous ? (replacement.bytes ? 0 : -1) : replacement.bytes ? 1 : 0;
      resultingBytes += nextBytes - (previous?.byteLength ?? 0);
      before.set(replacement.path, previous);
    }
    if (resultingFiles > this.limits.maxFiles) throw new MemoryError('Memory file limit exceeded.');
    if (resultingBytes > this.limits.maxTotalBytes) throw new MemoryError('Aggregate memory byte limit exceeded.');

    const applied: StorageReplacement[] = [];
    try {
      for (const replacement of ordered)
        this.publish(replacement.path, replacement.bytes, () => {
          // Rename/remove is the publication point. Track it before directory
          // fsync so a durability failure still rolls back the visible file.
          applied.push(replacement);
        });
    } catch (error: unknown) {
      let rollbackFailed = false;
      for (const replacement of applied.reverse()) {
        try {
          this.publish(replacement.path, before.get(replacement.path), () => undefined);
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
    let operationFailed = false;
    try {
      return index.search(query, state, options);
    } catch (error: unknown) {
      operationFailed = true;
      throw error;
    } finally {
      closeIndexPreservingError(index, operationFailed);
    }
  }

  /** {@inheritdoc StorageBackend.withLock} — shard-scoped directory lock. */
  public async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.withRepositoryAccess(async () => operation());
  }

  /** Lazily resolves storage so constructing a disabled store remains side-effect free. */
  private getRepositoryRoot(): Promise<ManagedRoot> {
    this.repositoryRoot ??= resolveManagedRoot(this.repositoryRootOptions);
    return this.repositoryRoot;
  }

  /** Runs directly under an existing lease or acquires the authority once. */
  private async withRepositoryAccess<T>(
    operation: (root: ManagedRoot, lease: RepositoryLease) => Promise<T>,
  ): Promise<T> {
    const root = await this.getRepositoryRoot();
    const existing = this.repositoryLease.getStore();
    if (existing !== undefined) return operation(root, existing);
    try {
      return await withRepositoryLease(root, async (lease) =>
        this.repositoryLease.run(lease, async () => operation(root, lease)),
      );
    } catch (error: unknown) {
      if (!(error instanceof RepositoryStoreError)) throw error;
      if (error.category === 'contention') throw new MemoryLockError(error.message, { cause: error });
      if (error.code === 'LIMIT_EXCEEDED' && error.message.includes('byte count'))
        throw new MemoryError('Aggregate memory byte limit exceeded.', { cause: error });
      if (error.code === 'LIMIT_EXCEEDED' && error.message.includes('file count'))
        throw new MemoryError('Memory file limit exceeded.', { cause: error });
      if (error.category === 'path_safety')
        throw new MemoryError(`Cannot safely read managed memory path: ${error.message}`, { cause: error });
      throw new MemoryError(error.message, { cause: error });
    }
  }

  /** {@inheritdoc StorageBackend.checkOrRebuildCache} */
  public async checkOrRebuildCache(state: ShardState): Promise<CacheValidation> {
    // Fresh connection per call: the index file can be replaced externally
    // (tests, manual deletion), and an open handle would read stale pages.
    const index = SqliteIndex.open(this.root);
    let operationFailed = false;
    try {
      if (!index.isStale(this.cacheMaxAgeMs, state))
        return { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' };
      index.rebuild(state);
      return { outcome: 'rebuilt', evidence: 'canonical_snapshot_rebuild_verified' };
    } catch (error: unknown) {
      operationFailed = true;
      throw error;
    } finally {
      closeIndexPreservingError(index, operationFailed);
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
      // leak the opened handle or be hidden by a cleanup safety error.
      closeIndexPreservingError(index, true);
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

  /**
   * Filesystem mode intentionally ignores the optional scope in canonical
   * storage, so all scopes sharing a root must also share one lock.
   */
  public get scopeKey(): string {
    return `${this.scope.organizationId}--${this.scope.projectId}`;
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

  public validateRecord(value: unknown, label = 'memory record'): MemoryRecord {
    return validateRecordHelper(value, this.helperDeps, label);
  }

  public validateTombstone(value: unknown, label = 'memory tombstone'): MemoryTombstone {
    return validateTombstoneHelper(value, this.helperDeps, label);
  }

  public encode(value: MemoryRecord | MemoryTombstone): Uint8Array {
    return Buffer.from(stringify(value, { lineWidth: 0 }), 'utf8');
  }

  private yamlFiles(directory: string): string[] {
    try {
      const stat = lstatSync(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new MemoryError(`Unsafe memory directory: ${directory}`);
    } catch (error: unknown) {
      if (isCode(error, 'ENOENT')) return [];
      throw error;
    }
    const identities = captureDirectoryIdentities(directory);
    const entries = readdirSync(directory, { withFileTypes: true });
    revalidateDirectoryIdentities(identities);
    return entries
      .filter((entry) => entry.name.endsWith('.yaml'))
      .map((entry) => {
        if (!entry.isFile() || entry.isSymbolicLink())
          throw new MemoryError(`Unsafe memory file: ${join(directory, entry.name)}`);
        return join(directory, entry.name);
      })
      .sort();
  }

  private trackUsage(path: string, size: number, files: number, bytes: number): { files: number; bytes: number } {
    if (size > this.limits.maxFileBytes) throw new MemoryError(`Memory file exceeds limit: ${path}`);
    const result = { files: files + 1, bytes: bytes + size };
    if (result.files > this.limits.maxFiles) throw new MemoryError('Memory file limit exceeded.');
    if (result.bytes > this.limits.maxTotalBytes) throw new MemoryError('Aggregate memory byte limit exceeded.');
    return result;
  }

  private parseCanonical(bytes: Uint8Array, path: string): unknown {
    return parseYamlBytes(bytes, path);
  }

  private assertFilenameIdentity(path: string, id: string): void {
    const filenameId = basename(path).replace(/\.yaml$/u, '');
    if (!isUlid(filenameId) || filenameId !== id)
      throw new MemoryError(`Memory filename does not match document ID: ${relative(this.root, path)}`);
  }

  private validateReplacementIdentity(path: string, bytes: Uint8Array): void {
    const safe = safeProjectPath(path);
    const filenameId = basename(safe).replace(/\.yaml$/u, '');
    if (!isUlid(filenameId)) throw new MemoryError(`Invalid memory filename: ${path}`);
    const document = parseYamlBytes(bytes, path);
    if (safe === `tombstones/${filenameId}.yaml`) {
      const tombstone = validateTombstoneHelper(document, this.helperDeps);
      if (tombstone.id !== filenameId) throw new MemoryError(`Memory filename does not match document ID: ${path}`);
      return;
    }
    for (const [recordType, folder] of Object.entries(RECORD_FOLDERS) as Array<[RecordType, string]>) {
      if (safe !== `${folder}/${filenameId}.yaml`) continue;
      const record = validateRecordHelper(document, this.helperDeps);
      if (record.id !== filenameId || record.record_type !== recordType)
        throw new MemoryError(`Memory filename does not match document identity: ${path}`);
      return;
    }
    throw new MemoryError(`Memory path does not map to a canonical document: ${path}`);
  }

  private publish(path: string, bytes: Uint8Array | undefined, published: () => void): void {
    const absolute = this.managedPath(path);
    const parent = dirname(absolute);
    this.ensureSafeDirectories(dirname(relative(this.root, absolute)).split(sep).join('/'));
    const parentIdentities = captureDirectoryIdentities(parent);
    if (!bytes) {
      if (assertRegularDestinationIfPresent(absolute)) {
        revalidateDirectoryIdentities(parentIdentities);
        rmSync(absolute);
        published();
        revalidateDirectoryIdentities(parentIdentities);
      }
      this.filesystemOps.syncDirectory(parent);
      return;
    }
    const temporary = join(parent, `.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    let temporaryIdentity: Stats | undefined;
    let parentIsCurrent = true;
    try {
      descriptor = openSync(
        temporary,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollowFlag(),
        0o600,
      );
      temporaryIdentity = fstatSync(descriptor);
      if (!temporaryIdentity.isFile()) throw new MemoryError(`Unsafe temporary memory file: ${temporary}`);
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      assertRegularDestinationIfPresent(absolute);
      revalidateDirectoryIdentities(parentIdentities);
      this.filesystemOps.renameSync(temporary, absolute);
      published();
      const destinationStat = lstatSync(absolute);
      if (destinationStat.isSymbolicLink() || !sameIdentity(temporaryIdentity, destinationStat))
        throw new MemoryError(`Memory destination changed during publication: ${absolute}`);
      try {
        revalidateDirectoryIdentities(parentIdentities);
      } catch (error: unknown) {
        parentIsCurrent = false;
        throw error;
      }
      this.filesystemOps.syncDirectory(parent);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      // Never clean up through a parent path that was rebound concurrently.
      if (parentIsCurrent) rmSync(temporary, { force: true });
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
      try {
        const stat = lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new MemoryError(`Unsafe memory path ancestor: ${path}`);
      } catch (error: unknown) {
        if (isCode(error, 'ENOENT')) return;
        throw error;
      }
    }
  }

  private ensureSafeDirectories(path: string): void {
    const target = resolve(this.root, path);
    const components: string[] = [];
    let current = target;
    while (dirname(current) !== current) {
      components.unshift(basename(current));
      current = dirname(current);
    }
    for (const component of components) {
      current = join(current, component);
      try {
        const stat = lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new MemoryError('Unsafe memory directory ancestor.');
      } catch (error: unknown) {
        if (!isCode(error, 'ENOENT')) throw error;
        mkdirSync(current, { mode: 0o700 });
        const stat = lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new MemoryError('Unsafe memory directory ancestor.');
      }
    }
  }

  /** Reads only verified file metadata for pre-batch resource accounting. */
  private regularSize(path: string): number {
    let descriptor: number | undefined;
    try {
      const parentIdentities = captureDirectoryIdentities(dirname(path));
      descriptor = openSync(path, fsConstants.O_RDONLY | noFollowFlag());
      const openedStat = fstatSync(descriptor);
      if (!openedStat.isFile()) throw new MemoryError('Managed memory path is not a regular file.');
      const pathStat = lstatSync(path);
      if (pathStat.isSymbolicLink() || !sameIdentity(openedStat, pathStat))
        throw new MemoryError('Managed memory path changed while it was opened.');
      revalidateDirectoryIdentities(parentIdentities);
      return openedStat.size;
    } catch (error: unknown) {
      if (error instanceof MemoryError) throw error;
      if (isCode(error, 'ENOENT')) throw new MissingMemoryPathError(path);
      throw new MemoryError(`Cannot safely inspect managed memory path: ${path}: ${describe(error)}`);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  /** Discovers and reads canonical YAML through repository-store safety checks. */
  private async repositoryYamlFiles(folder: string): Promise<Array<{ path: string; content: Uint8Array }>> {
    const root = await this.getRepositoryRoot();
    const lease = this.repositoryLease.getStore();
    if (lease === undefined) throw new MemoryError('Canonical read requires the repository authority lease.');
    const files = await scanManagedFiles(root, lease, {
      under: [resolveManagedPath(root, folder)],
      accept: (path) =>
        path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes('/') && path.endsWith('.yaml'),
    });
    return files.map((file) => ({ path: join(this.root, file.path.relativePath), content: file.bytes }));
  }

  private readRegular(path: string): Uint8Array {
    let descriptor: number | undefined;
    try {
      const parentIdentities = captureDirectoryIdentities(dirname(path));
      descriptor = openSync(path, fsConstants.O_RDONLY | noFollowFlag());
      const openedStat = fstatSync(descriptor);
      if (!openedStat.isFile()) throw new MemoryError('Managed memory path is not a regular file.');
      const pathStat = lstatSync(path);
      if (pathStat.isSymbolicLink() || !sameIdentity(openedStat, pathStat))
        throw new MemoryError('Managed memory path changed while it was opened.');
      const bytes = readFileSync(descriptor);
      revalidateDirectoryIdentities(parentIdentities);
      return bytes;
    } catch (error: unknown) {
      if (error instanceof MemoryError) throw error;
      if (isCode(error, 'ENOENT')) throw new MissingMemoryPathError(path);
      throw new MemoryError(`Cannot safely read managed memory path: ${path}: ${describe(error)}`);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  private readRegularIfExists(path: string): Uint8Array | undefined {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new MemoryError('Managed memory path is not a regular file.');
    } catch (error: unknown) {
      if (isCode(error, 'ENOENT')) return undefined;
      throw error;
    }
    return this.readRegular(path);
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

function assertSafeMemoryRoot(root: string): void {
  const components: string[] = [];
  let current = root;
  while (dirname(current) !== current) {
    components.unshift(basename(current));
    current = dirname(current);
  }
  for (const component of components) {
    current = join(current, component);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new MemoryError(`Unsafe memory root: ${root}`);
    } catch (error: unknown) {
      if (isCode(error, 'ENOENT')) return;
      throw error;
    }
  }
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

function parseYamlBytes(bytes: Uint8Array, path: string): unknown {
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

const DEFAULT_FILESYSTEM_OPERATIONS: FilesystemOperations = {
  renameSync,
  syncDirectory,
};

function captureDirectoryIdentities(directory: string): DirectoryIdentity[] {
  return captureDirectoryIdentityChain(directory, 'memory directory');
}

function revalidateDirectoryIdentities(identities: readonly DirectoryIdentity[]): void {
  revalidateDirectoryIdentityChain(identities, 'Memory directory');
}

function assertRegularDestinationIfPresent(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new MemoryError(`Unsafe memory destination: ${path}`);
    return true;
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT')) return false;
    throw error;
  }
}

/** Closes the cache without replacing an error from the primary operation. */
function closeIndexPreservingError(index: SqliteIndex, operationFailed: boolean): void {
  try {
    index.close();
  } catch (error: unknown) {
    if (!operationFailed) throw error;
  }
}

function syncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | noFollowFlag());
    if (!fstatSync(descriptor).isDirectory()) throw new MemoryError(`Unsafe memory directory: ${path}`);
    fsyncSync(descriptor);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(code ?? '')) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

class MissingMemoryPathError extends MemoryError {
  public constructor(path: string) {
    super(`Managed memory path does not exist: ${path}`);
    this.name = 'MissingMemoryPathError';
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
