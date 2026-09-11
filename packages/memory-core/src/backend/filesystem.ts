import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
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
import { isUlid } from '../identities.js';
import { openMemoryCache, rebuildMemoryCache, removeMemoryCache, searchMemoryCache } from '../index-sqlite.js';
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
  private repositoryRoot?: Promise<ManagedRoot>;
  private readonly repositoryRootOptions: ManagedRootOptions;
  private readonly repositoryLease = new AsyncLocalStorage<RepositoryLease>();

  public constructor(options: FilesystemBackendOptions) {
    this.root = resolve(options.cwd, options.config.root);
    assertSafeMemoryRoot(this.root);
    this.cacheMaxAgeMs = options.config.cache.max_age_ms;
    this.stalePolicy = options.config.cache.stale_policy;
    this.onStaleCache = options.onStaleCache;
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
        maxTemporaryBytes: Math.max(DEFAULT_STORE_LIMITS.maxTemporaryBytes, this.limits.maxTotalBytes),
        maxStatementParameterBytes: Math.min(
          Number.MAX_SAFE_INTEGER,
          Math.max(DEFAULT_STORE_LIMITS.maxStatementParameterBytes, this.limits.maxFileBytes + 64 * 1024),
        ),
        maxQueryResultBytes: Math.min(
          Number.MAX_SAFE_INTEGER,
          Math.max(DEFAULT_STORE_LIMITS.maxQueryResultBytes, this.limits.maxFileBytes + 64 * 1024),
        ),
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

  /** {@inheritdoc StorageBackend.search} — BM25 over a disposable projection. */
  public async search(state: ShardState, query: string, options: BackendSearchOptions): Promise<MemoryRecord[]> {
    return this.withRepositoryAccess(async (root, lease) => {
      let cache = await openMemoryCache(root, lease, state, this.cacheMaxAgeMs);
      if (cache === undefined) {
        await this.resolveStaleness();
        cache = await rebuildMemoryCache(root, lease, state);
      }
      let primaryError: unknown;
      let result: MemoryRecord[] | undefined;
      try {
        result = await searchMemoryCache(cache, query, state, options);
      } catch (error: unknown) {
        primaryError = error;
      }
      try {
        await cache.close();
      } catch (error: unknown) {
        primaryError ??= error;
      }
      if (primaryError !== undefined) throw primaryError;
      return result as MemoryRecord[];
    });
  }

  /** {@inheritdoc StorageBackend.withLock} */
  public async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.withRepositoryAccess(async () => operation());
  }

  /** Lazily resolves storage so disabled construction remains side-effect free. */
  private async getRepositoryRoot(): Promise<ManagedRoot> {
    if (this.repositoryRoot !== undefined) return this.repositoryRoot;
    const resolution = resolveManagedRoot(this.repositoryRootOptions);
    this.repositoryRoot = resolution;
    try {
      return await resolution;
    } catch (error: unknown) {
      if (this.repositoryRoot === resolution) this.repositoryRoot = undefined;
      throw error;
    }
  }

  /** Runs under an existing lease or acquires the shared repository authority. */
  private async withRepositoryAccess<T>(
    operation: (root: ManagedRoot, lease: RepositoryLease) => Promise<T>,
  ): Promise<T> {
    try {
      const root = await this.getRepositoryRoot();
      const existing = this.repositoryLease.getStore();
      if (existing !== undefined) return await operation(root, existing);
      return await withRepositoryLease(root, async (lease) =>
        this.repositoryLease.run(lease, async () => operation(root, lease)),
      );
    } catch (error: unknown) {
      if (!(error instanceof RepositoryStoreError)) throw error;
      if (error.category === 'contention') throw new MemoryLockError(error.message, { cause: error });
      if (error.code === 'REVISION_MISMATCH') throw new MemoryConflictError(error.message);
      if (error.code === 'LIMIT_EXCEEDED' && /byte (?:count|limit)/u.test(error.message))
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
    return this.withRepositoryAccess(async (root, lease) => {
      const opened = await openMemoryCache(root, lease, state, this.cacheMaxAgeMs);
      if (opened !== undefined) {
        await opened.close();
        return { outcome: 'checked', evidence: 'canonical_snapshot_match_verified' };
      }
      const rebuilt = await rebuildMemoryCache(root, lease, state);
      await rebuilt.close();
      return { outcome: 'rebuilt', evidence: 'canonical_snapshot_rebuild_verified' };
    });
  }

  /** {@inheritdoc StorageBackend.resetCache} */
  public async resetCache(): Promise<void> {
    return this.withRepositoryAccess((root, lease) => removeMemoryCache(root, lease));
  }

  /** {@inheritdoc StorageBackend.close} — cache handles are operation-scoped. */
  public async close(): Promise<void> {
    await Promise.resolve();
  }

  private async resolveStaleness(): Promise<void> {
    switch (this.stalePolicy) {
      case 'rebuild':
        return;
      case 'fail':
        throw new MemoryError('Memory cache is stale and cache.stale_policy is fail; run memory_validate.');
      case 'prompt':
        if (this.onStaleCache === undefined || (await this.onStaleCache()) === true) return;
        throw new MemoryError('Memory cache is stale; rebuild declined by the host.');
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

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
