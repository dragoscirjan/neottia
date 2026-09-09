import { resolve } from 'node:path';
import {
  DEFAULT_STORE_LIMITS,
  applyCanonicalBatch,
  resolveManagedPath,
  resolveManagedRoot,
  withRepositoryLease,
  type CanonicalOperation,
  type ManagedRoot,
  type OperationControl,
  type RepositoryLease,
  type StoreLimits,
} from '@neottia/repository-store';
import { parseAllDocuments } from 'yaml';
import { ensureIssueCache, issueMatchesSearch, searchIssueCache, type IssueSearchFilters } from './cache.js';
import { inspectIssueCatalog, loadIssueCatalog, type CatalogIssue } from './catalog.js';
import { compareCodePoints, decodeIssue as decodeImported, encodeIssue, issueFilename } from './codec.js';
import type { IssueConfig } from './config.js';
import { IssueError, asIssueError } from './errors.js';
import { hydrateIssue, inspectIssueGraph, issueSubtree, validateIssueGraph } from './graph.js';
import { createUlid } from './identities.js';
import type { DesignDocumentReferenceResolver } from './resolver.js';
import type {
  DesignDocumentReference,
  Issue,
  IssueLocation,
  IssueRecord,
  IssueStatus,
  IssueType,
  IssueValidationReport,
} from './schemas.js';

/** Constructor integrations kept outside canonical issue state. */
export interface IssueStoreOptions {
  readonly resolver?: DesignDocumentReferenceResolver;
  readonly onStaleCache?: () => boolean | Promise<boolean>;
}

export interface CreateIssueInput {
  readonly type: IssueType;
  readonly title: string;
  readonly body?: string;
  readonly created_by?: string;
  readonly assigned_to?: string;
  readonly parent?: string;
  readonly metadata?: IssueRecord['metadata'];
}

export interface UpdateIssueInput {
  readonly title?: string;
  readonly body?: string;
  readonly assigned_to?: string | null;
  readonly parent?: string | null;
  readonly metadata?: IssueRecord['metadata'];
}

export interface RelateIssueInput {
  readonly source_id: string;
  readonly target_id: string;
  readonly relationship: 'depends_on' | 'relates_to' | 'duplicates' | 'supersedes';
  readonly expected_revision?: string;
}

// Repository-store leases intentionally reject same-process reentrancy. This
// authority queue serializes overlapping in-process host calls before lease entry.
const authorityQueues = new Map<string, Promise<void>>();

/** Filesystem-canonical Issues implementation serialized by repository-store. */
export class IssueStore {
  private rootPromise?: Promise<ManagedRoot>;
  private cacheRootPromise?: Promise<ManagedRoot>;

  constructor(
    readonly config: IssueConfig,
    readonly cwd: string,
    private readonly options: IssueStoreOptions = {},
  ) {}

  /** Generates a collision-checked stable identifier without publishing a file. */
  async id(control: OperationControl = {}): Promise<{ id: string }> {
    return this.withCatalog(async (_root, _lease, catalog) => {
      for (let attempts = 0; attempts < 32; attempts++) {
        const id = `${this.config.prefix}${createUlid()}`;
        if (!catalog.has(id)) return { id };
      }
      throw new IssueError('Unable to allocate a unique issue ID.', 'conflict', 'ID_COLLISION', { retryable: true });
    }, control);
  }

  /** Creates one issue after validating the complete proposed graph. */
  async create(input: CreateIssueInput, control: OperationControl = {}): Promise<Issue> {
    return this.withCatalog(async (root, lease, catalog) => {
      let id: string | undefined;
      for (let attempts = 0; attempts < 32 && id === undefined; attempts++) {
        const candidate = `${this.config.prefix}${createUlid()}`;
        if (!catalog.has(candidate)) id = candidate;
      }
      if (!id) throw new IssueError('Unable to allocate a unique issue ID.', 'conflict', 'ID_COLLISION');
      const now = new Date().toISOString();
      const record: IssueRecord = {
        version: 1,
        id,
        type: input.type,
        title: input.title,
        status: 'open',
        created_at: now,
        updated_at: now,
        ...(input.created_by === undefined ? {} : { created_by: input.created_by }),
        ...(input.assigned_to === undefined ? {} : { assigned_to: input.assigned_to }),
        ...(input.parent === undefined ? {} : { parent: input.parent }),
        depends_on: [],
        relates_to: [],
        duplicates: [],
        supersedes: [],
        body: input.body ?? '',
        metadata: input.metadata ?? {},
        comments: [],
        links: [],
      };
      const path = `${this.config.root}/${issueFilename(id, record.title)}`;
      const proposed = cloneCatalog(catalog);
      proposed.set(id, proposedEntry(root, record, path, 'active'));
      await this.validateProposed(proposed, lease, control);
      await this.apply(
        root,
        lease,
        [{ kind: 'write', path: resolveManagedPath(root, path), bytes: encodeIssue(record), expected: 'absent' }],
        control,
      );
      return hydrateIssue(await this.reload(root, lease, control), id);
    }, control);
  }

  /** Hydrates one canonical issue by stable ID. */
  async get(id: string, control: OperationControl = {}): Promise<Issue> {
    return this.withCatalog(async (_root, _lease, catalog) => hydrateIssue(catalog, id), control);
  }

  /** Lists canonical issues in stable updated-time/ID order. */
  async list(
    filters: {
      status?: IssueStatus;
      type?: IssueType;
      assignee?: string;
      parent?: string;
      location?: IssueLocation;
      limit?: number;
    } = {},
    control: OperationControl = {},
  ): Promise<readonly Issue[]> {
    return this.withCatalog(
      async (_root, _lease, catalog) =>
        [...catalog.keys()]
          .map((id) => hydrateIssue(catalog, id))
          .filter((issue) => matches(issue, filters))
          .sort(issueOrder)
          .slice(0, filters.limit ?? this.config.retrieval.limit)
          .reduce<Issue[]>(
            (bounded, issue) => appendWithinBudget(bounded, issue, this.config.security.max_result_bytes),
            [],
          ),
      control,
    );
  }

  /** Executes ranked FTS5 search and hydrates every candidate from YAML. */
  async search(
    query: string,
    filters: Partial<IssueSearchFilters> = {},
    control: OperationControl = {},
  ): Promise<readonly Issue[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new IssueError('Search query must not be blank.', 'validation', 'QUERY_INVALID');
    if (Buffer.byteLength(normalizedQuery) > this.config.security.max_query_bytes)
      throw new IssueError('Search query exceeds configured byte limit.', 'validation', 'QUERY_TOO_LARGE');
    return this.withCatalog(async (root, lease, catalog) => {
      let policy = this.config.cache.stale_policy;
      if (policy === 'prompt') policy = (await this.options.onStaleCache?.()) === false ? 'fail' : 'rebuild';
      const handle = await ensureIssueCache(
        await this.cacheRoot(),
        lease,
        catalog,
        policy,
        this.config.cache.max_age_ms,
        control,
      );
      try {
        const candidates = await searchIssueCache(handle.cache, normalizedQuery, {
          limit: filters.limit ?? this.config.retrieval.limit,
          maxBytes: filters.maxBytes ?? this.config.retrieval.max_bytes,
          status: filters.status,
          type: filters.type,
          assignee: filters.assignee,
          parent: filters.parent,
          location: filters.location,
        });
        // Cache candidates are only hints. Re-read the complete canonical
        // snapshot and reapply text/filter predicates before returning data.
        const refreshed = await this.reload(root, lease, control);
        validateIssueGraph(refreshed);
        await this.validateReferences(refreshed, lease, control);
        return candidates.reduce<Issue[]>((bounded, candidate) => {
          const canonical = refreshed.get(candidate.id);
          if (canonical?.revision !== candidate.revision) return bounded;
          const issue = hydrateIssue(refreshed, candidate.id);
          if (!matches(issue, filters) || !issueMatchesSearch(issue, normalizedQuery)) return bounded;
          return appendWithinBudget(bounded, issue, filters.maxBytes ?? this.config.retrieval.max_bytes);
        }, []);
      } finally {
        await handle.close();
      }
    }, control);
  }

  /** Replaces mutable fields using exact source revision evidence. */
  async update(
    id: string,
    expectedRevision: string,
    patch: UpdateIssueInput,
    control: OperationControl = {},
  ): Promise<Issue> {
    return this.mutateRecord(id, expectedRevision, control, (record) => ({
      ...record,
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.body === undefined ? {} : { body: patch.body }),
      ...(patch.assigned_to === undefined
        ? {}
        : patch.assigned_to === null
          ? { assigned_to: undefined }
          : { assigned_to: patch.assigned_to }),
      ...(patch.parent === undefined ? {} : patch.parent === null ? { parent: undefined } : { parent: patch.parent }),
      ...(patch.metadata === undefined ? {} : { metadata: patch.metadata }),
    }));
  }

  /** Performs an explicit lifecycle status transition with revision evidence. */
  async transition(
    id: string,
    status: IssueStatus,
    expectedRevision: string,
    control: OperationControl = {},
  ): Promise<Issue> {
    return this.mutateRecord(id, expectedRevision, control, (record) => ({ ...record, status }));
  }

  /** Serializes an append-only comment; supplied revision evidence is enforced. */
  async comment(
    id: string,
    author: string,
    body: string,
    expectedRevision?: string,
    control: OperationControl = {},
  ): Promise<Issue> {
    return this.mutateRecord(
      id,
      expectedRevision,
      control,
      (record) => ({
        ...record,
        comments: [
          ...record.comments,
          { id: `comment-${createUlid()}`, author, body, created_at: new Date().toISOString() },
        ],
      }),
      false,
    );
  }

  /** Adds an idempotent directional or symmetric relation. */
  async relate(input: RelateIssueInput, control: OperationControl = {}): Promise<Issue> {
    return this.withCatalog(async (root, lease, catalog) => {
      const source = requireEntry(catalog, input.source_id);
      requireEntry(catalog, input.target_id);
      let ownerId = input.source_id;
      let targetId = input.target_id;
      if (input.relationship === 'relates_to' && ownerId > targetId) [ownerId, targetId] = [targetId, ownerId];
      const owner = requireEntry(catalog, ownerId);
      if (input.expected_revision !== undefined) assertRevision(source, input.expected_revision);
      if (owner.record[input.relationship].includes(targetId)) return hydrateIssue(catalog, ownerId);
      const next = {
        ...owner.record,
        [input.relationship]: [...owner.record[input.relationship], targetId],
        updated_at: new Date().toISOString(),
      };
      const result = await this.publishRecord(root, lease, catalog, ownerId, next, control);
      return hydrateIssue(result, ownerId);
    }, control);
  }

  /** Removes a relation and requires the deterministic owner's current revision. */
  async unrelate(
    input: RelateIssueInput & { expected_revision: string },
    control: OperationControl = {},
  ): Promise<Issue> {
    return this.withCatalog(async (root, lease, catalog) => {
      let ownerId = input.source_id;
      let targetId = input.target_id;
      if (input.relationship === 'relates_to' && ownerId > targetId) [ownerId, targetId] = [targetId, ownerId];
      const owner = requireEntry(catalog, ownerId);
      assertRevision(owner, input.expected_revision);
      const values = owner.record[input.relationship];
      if (!values.includes(targetId)) return hydrateIssue(catalog, ownerId);
      const next = {
        ...owner.record,
        [input.relationship]: values.filter((value) => value !== targetId),
        updated_at: new Date().toISOString(),
      };
      const result = await this.publishRecord(root, lease, catalog, ownerId, next, control);
      return hydrateIssue(result, ownerId);
    }, control);
  }

  /** Adds a resolver-verified stable design-document identity. */
  async linkDocument(
    id: string,
    reference: DesignDocumentReference,
    expectedRevision?: string,
    control: OperationControl = {},
  ): Promise<Issue> {
    return this.mutateRecord(
      id,
      expectedRevision,
      control,
      (record) => {
        const key = linkKey(reference);
        return record.links.some((link) => linkKey(link) === key)
          ? record
          : { ...record, links: [...record.links, reference] };
      },
      false,
    );
  }

  /** Removes a typed link without needing the target domain to remain available. */
  async unlinkDocument(
    id: string,
    reference: DesignDocumentReference,
    expectedRevision: string,
    control: OperationControl = {},
  ): Promise<Issue> {
    return this.mutateRecord(
      id,
      expectedRevision,
      control,
      (record) => ({ ...record, links: record.links.filter((link) => linkKey(link) !== linkKey(reference)) }),
      false,
      true,
    );
  }

  /** Archives an issue and every active descendant in one recoverable batch. */
  async archive(id: string, expectedRevision: string, control: OperationControl = {}): Promise<readonly Issue[]> {
    return this.moveSubtree(id, expectedRevision, 'active', 'archive', control);
  }

  /** Restores an archived issue and every archived descendant symmetrically. */
  async restore(id: string, expectedRevision: string, control: OperationControl = {}): Promise<readonly Issue[]> {
    return this.moveSubtree(id, expectedRevision, 'archive', 'active', control);
  }

  /** Returns bounded canonical diagnostics and verifies the disposable cache. */
  async validate(control: OperationControl = {}): Promise<IssueValidationReport> {
    this.assertEnabled();
    return enqueueAuthority(resolve(this.cwd), control, async () => {
      try {
        const root = await this.root();
        return await withRepositoryLease(
          root,
          async (lease) => {
            const inspected = await inspectIssueCatalog(root, lease, this.config.root, this.config.prefix, control);
            const findings = [...inspected.findings];
            if (!findings.length) {
              findings.push(...inspectIssueGraph(inspected.catalog));
              if (!findings.length)
                try {
                  await this.validateReferences(inspected.catalog, lease, control);
                } catch (error: unknown) {
                  findings.push(errorFinding(asIssueError(error)));
                }
            }
            if (findings.length) return report(inspected.catalog, findings.slice(0, 1000), 'skipped');
            let policy = this.config.cache.stale_policy;
            if (policy === 'prompt') policy = (await this.options.onStaleCache?.()) === false ? 'fail' : 'rebuild';
            const handle = await ensureIssueCache(
              await this.cacheRoot(),
              lease,
              inspected.catalog,
              policy,
              this.config.cache.max_age_ms,
              control,
            );
            const cache = handle.rebuilt ? 'rebuilt' : 'checked';
            await handle.close();
            return report(inspected.catalog, [], cache);
          },
          { ...control, waitMs: this.config.lock.wait_ms, staleMs: this.config.lock.stale_ms },
        );
      } catch (error: unknown) {
        return report(new Map(), [errorFinding(asIssueError(error))], 'skipped');
      }
    });
  }

  /** Exports a deterministic object suitable for native round trips. */
  async export(
    control: OperationControl = {},
  ): Promise<{ format: 'neottia-issues-v1'; content: string; count: number }> {
    return this.withCatalog(async (_root, _lease, catalog) => {
      const issues = [...catalog.values()]
        .sort((left, right) => compareCodePoints(left.record.id, right.record.id))
        .map((entry) => ({
          location: entry.location,
          record: decodeImported(encodeIssue(entry.record), this.config.prefix).record,
        }));
      const content = `${JSON.stringify({ version: 1, issues }, null, 2)}\n`;
      assertOutputBudget(content, this.config.security.max_result_bytes);
      return { format: 'neottia-issues-v1', content, count: issues.length };
    }, control);
  }

  /** Previews or imports native JSON and one-record harnessctl YAML. */
  async import(
    content: string,
    preview = true,
    control: OperationControl = {},
  ): Promise<{
    valid: boolean;
    preview: boolean;
    planned: number;
    imported: number;
    warnings: string[];
    errors: string[];
  }> {
    this.assertEnabled();
    return this.withCatalog(async (root, lease, catalog) => {
      let parsedImport: { items: Array<{ location: IssueLocation; record: IssueRecord }>; warnings: string[] };
      try {
        parsedImport = await parseImport(content, this.config.prefix, this.options.resolver, lease, control);
      } catch (error: unknown) {
        return { valid: false, preview, planned: 0, imported: 0, warnings: [], errors: [asIssueError(error).message] };
      }
      const imported = parsedImport.items;
      const proposed = cloneCatalog(catalog);
      const operations: CanonicalOperation[] = [];
      for (const item of imported) {
        if (proposed.has(item.record.id))
          return {
            valid: false,
            preview,
            planned: imported.length,
            imported: 0,
            warnings: parsedImport.warnings,
            errors: [`Issue already exists: ${item.record.id}`],
          };
        const path = issuePath(this.config.root, item.location, item.record);
        proposed.set(item.record.id, proposedEntry(root, item.record, path, item.location));
        operations.push({
          kind: 'write',
          path: resolveManagedPath(root, path),
          bytes: encodeIssue(item.record),
          expected: 'absent',
        });
      }
      try {
        await this.validateProposed(proposed, lease, control);
      } catch (error: unknown) {
        return {
          valid: false,
          preview,
          planned: imported.length,
          imported: 0,
          warnings: parsedImport.warnings,
          errors: [asIssueError(error).message],
        };
      }
      if (!preview) await this.apply(root, lease, operations, control);
      return {
        valid: true,
        preview,
        planned: imported.length,
        imported: preview ? 0 : imported.length,
        warnings: parsedImport.warnings,
        errors: [],
      };
    }, control);
  }

  private async moveSubtree(
    id: string,
    expectedRevision: string,
    from: IssueLocation,
    to: IssueLocation,
    control: OperationControl,
  ): Promise<readonly Issue[]> {
    return this.withCatalog(async (root, lease, catalog) => {
      const start = requireEntry(catalog, id);
      assertRevision(start, expectedRevision);
      const ids = issueSubtree(catalog, id, from);
      const proposed = cloneCatalog(catalog);
      const operations: CanonicalOperation[] = [];
      for (const childId of ids) {
        const entry = requireEntry(catalog, childId);
        const destination = issuePath(this.config.root, to, entry.record);
        if ([...catalog.values()].some((other) => other.relativePath === destination))
          throw new IssueError(`Archive/restore destination exists: ${destination}`, 'conflict', 'DESTINATION_EXISTS');
        operations.push({
          kind: 'move',
          from: entry.path,
          to: resolveManagedPath(root, destination),
          expectedSource: entry.byteRevision,
          expectedDestination: 'absent',
        });
        proposed.set(childId, {
          ...entry,
          path: resolveManagedPath(root, destination),
          relativePath: destination,
          location: to,
        });
      }
      await this.validateProposed(proposed, lease, control);
      await this.apply(root, lease, operations, control);
      const updated = await this.reload(root, lease, control);
      return ids.map((childId) => hydrateIssue(updated, childId));
    }, control);
  }

  private async mutateRecord(
    id: string,
    expectedRevision: string | undefined,
    control: OperationControl,
    change: (record: IssueRecord) => IssueRecord,
    requireExpected = true,
    skipReferenceValidation = false,
  ): Promise<Issue> {
    return this.withCatalog(async (root, lease, catalog) => {
      const entry = requireEntry(catalog, id);
      if (requireExpected && expectedRevision === undefined)
        throw new IssueError('expected_revision is required.', 'conflict', 'REVISION_REQUIRED');
      if (expectedRevision !== undefined) assertRevision(entry, expectedRevision);
      const changed = change(structuredClone(entry.record));
      if (JSON.stringify(changed) === JSON.stringify(entry.record)) return hydrateIssue(catalog, id);
      const next = { ...changed, updated_at: new Date().toISOString() };
      return hydrateIssue(
        await this.publishRecord(root, lease, catalog, id, next, control, skipReferenceValidation),
        id,
      );
    }, control);
  }

  private async publishRecord(
    root: ManagedRoot,
    lease: RepositoryLease,
    catalog: Map<string, CatalogIssue>,
    id: string,
    record: IssueRecord,
    control: OperationControl,
    skipReferenceValidation = false,
  ): Promise<Map<string, CatalogIssue>> {
    const current = requireEntry(catalog, id);
    const destination = issuePath(this.config.root, current.location, record);
    const proposed = cloneCatalog(catalog);
    proposed.set(id, proposedEntry(root, record, destination, current.location, current.revision));
    this.validateResourceLimits(proposed);
    validateIssueGraph(proposed);
    if (!skipReferenceValidation) await this.validateReferences(proposed, lease, control);
    const bytes = encodeIssue(record);
    const operations: CanonicalOperation[] =
      destination === current.relativePath
        ? [{ kind: 'write', path: current.path, bytes, expected: current.byteRevision }]
        : [
            { kind: 'remove', path: current.path, expected: current.byteRevision },
            { kind: 'write', path: resolveManagedPath(root, destination), bytes, expected: 'absent' },
          ];
    await this.apply(root, lease, operations, control);
    return this.reload(root, lease, control);
  }

  private async validateProposed(
    catalog: ReadonlyMap<string, CatalogIssue>,
    lease: RepositoryLease,
    control: OperationControl,
  ): Promise<void> {
    this.validateResourceLimits(catalog);
    validateIssueGraph(catalog);
    await this.validateReferences(catalog, lease, control);
  }

  private validateResourceLimits(catalog: ReadonlyMap<string, CatalogIssue>): void {
    if (catalog.size > this.config.security.max_files)
      throw new IssueError('Issue count exceeds the configured limit.', 'validation', 'LIMIT_EXCEEDED', {
        details: { limit: 'max_files', maximum: this.config.security.max_files },
      });
    const total = [...catalog.values()].reduce((bytes, entry) => bytes + entry.size, 0);
    if (total > this.config.security.max_total_bytes)
      throw new IssueError('Issue bytes exceed the configured aggregate limit.', 'validation', 'LIMIT_EXCEEDED', {
        details: { limit: 'max_total_bytes', maximum: this.config.security.max_total_bytes },
      });
  }

  private async validateReferences(
    catalog: ReadonlyMap<string, CatalogIssue>,
    lease: RepositoryLease,
    control: OperationControl,
  ): Promise<void> {
    const references = [...catalog.values()].flatMap((entry) => entry.record.links);
    if (!references.length) return;
    if (!this.options.resolver)
      throw new IssueError(
        'Design-document links require a configured resolver.',
        'cross_domain',
        'RESOLVER_UNAVAILABLE',
      );
    const batch = await this.options.resolver.resolveMany(references, { lease, ...control });
    if (batch.status !== 'ok')
      throw new IssueError(`Design-document target snapshot is ${batch.status}.`, 'cross_domain', 'TARGET_INVALID');
    if (
      batch.results.length !== references.length ||
      batch.results.some(
        (result, index) =>
          result.status !== 'resolved' ||
          linkKey(result.reference) !== linkKey(references[index] as DesignDocumentReference),
      )
    )
      throw new IssueError('One or more design-document links are unresolved.', 'cross_domain', 'LINK_UNRESOLVED');
  }

  private async withCatalog<T>(
    operation: (root: ManagedRoot, lease: RepositoryLease, catalog: Map<string, CatalogIssue>) => Promise<T>,
    control: OperationControl,
  ): Promise<T> {
    this.assertEnabled();
    return enqueueAuthority(resolve(this.cwd), control, async () => {
      try {
        const root = await this.root();
        return await withRepositoryLease(
          root,
          async (lease) => {
            const catalog = await this.reload(root, lease, control);
            validateIssueGraph(catalog);
            return operation(root, lease, catalog);
          },
          { ...control, waitMs: this.config.lock.wait_ms, staleMs: this.config.lock.stale_ms },
        );
      } catch (error: unknown) {
        throw asIssueError(error);
      }
    });
  }

  private async reload(
    root: ManagedRoot,
    lease: RepositoryLease,
    control: OperationControl,
  ): Promise<Map<string, CatalogIssue>> {
    return loadIssueCatalog(root, lease, this.config.root, this.config.prefix, control);
  }

  private async apply(
    root: ManagedRoot,
    lease: RepositoryLease,
    operations: readonly CanonicalOperation[],
    control: OperationControl,
  ): Promise<void> {
    await applyCanonicalBatch(root, lease, operations, {
      ...control,
      inventory: [resolveManagedPath(root, this.config.root), resolveManagedPath(root, `${this.config.root}/archive`)],
    });
  }

  private root(): Promise<ManagedRoot> {
    this.rootPromise ??= resolveManagedRoot({ authorityRoot: resolve(this.cwd), limits: this.storeLimits() });
    return this.rootPromise;
  }

  private cacheRoot(): Promise<ManagedRoot> {
    this.cacheRootPromise ??= resolveManagedRoot({
      authorityRoot: resolve(this.cwd),
      managedPath: '.neottia/cache',
      limits: this.storeLimits(),
    });
    return this.cacheRootPromise;
  }

  private storeLimits(): StoreLimits {
    return {
      ...DEFAULT_STORE_LIMITS,
      maxFileBytes: this.config.security.max_file_bytes,
      maxFiles: this.config.security.max_files,
      maxTotalBytes: this.config.security.max_total_bytes,
      maxBatchPaths: this.config.security.max_batch_paths,
      maxBeforeImageBytes: this.config.security.max_total_bytes,
      maxTemporaryBytes: this.config.security.max_total_bytes,
      maxQueryRows: this.config.security.max_query_rows,
      maxQueryResultBytes: this.config.security.max_result_bytes,
    };
  }

  private assertEnabled(): void {
    if (!this.config.enabled)
      throw new IssueError('Issues capability is disabled.', 'configuration', 'ISSUES_DISABLED');
  }
}

/** Serializes one operation per repository authority inside this process. */
async function enqueueAuthority<T>(key: string, control: OperationControl, operation: () => Promise<T>): Promise<T> {
  const previous = authorityQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolveQueue) => {
    release = resolveQueue;
  });
  authorityQueues.set(key, current);
  try {
    await waitForQueue(previous, control);
  } catch (error: unknown) {
    // A cancelled waiter remains in the ordering chain until its predecessor
    // exits, preventing later calls from entering beside the live lease.
    void previous.finally(() => {
      release();
      if (authorityQueues.get(key) === current) authorityQueues.delete(key);
    });
    throw error;
  }
  try {
    return await operation();
  } finally {
    release();
    if (authorityQueues.get(key) === current) authorityQueues.delete(key);
  }
}

async function waitForQueue(previous: Promise<void>, control: OperationControl): Promise<void> {
  if (control.signal?.aborted) throw queueCancellation('ABORTED');
  if (control.deadline !== undefined && Date.now() >= control.deadline) throw queueCancellation('DEADLINE_EXCEEDED');
  await new Promise<void>((resolveWait, rejectWait) => {
    let settled = false;
    const finish = (error?: IssueError): void => {
      if (settled) return;
      settled = true;
      control.signal?.removeEventListener('abort', aborted);
      if (timer !== undefined) clearTimeout(timer);
      if (error) rejectWait(error);
      else resolveWait();
    };
    const aborted = (): void => finish(queueCancellation('ABORTED'));
    const timer =
      control.deadline === undefined
        ? undefined
        : setTimeout(() => finish(queueCancellation('DEADLINE_EXCEEDED')), Math.max(0, control.deadline - Date.now()));
    control.signal?.addEventListener('abort', aborted, { once: true });
    void previous.then(
      () => finish(),
      () => finish(),
    );
  });
}

function queueCancellation(code: 'ABORTED' | 'DEADLINE_EXCEEDED'): IssueError {
  return new IssueError(
    code === 'ABORTED' ? 'Issue operation was aborted while queued.' : 'Issue operation deadline expired while queued.',
    'conflict',
    code,
    { retryable: true },
  );
}

function appendWithinBudget(issues: Issue[], issue: Issue, maxBytes: number): Issue[] {
  const proposed = [...issues, issue];
  assertOutputBudget({ issues: proposed }, maxBytes);
  return proposed;
}

function assertOutputBudget(value: unknown, maxBytes: number): void {
  if (Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8') > maxBytes)
    throw new IssueError(
      'Serialized issue output exceeds the configured byte limit.',
      'validation',
      'RESULT_TOO_LARGE',
      {
        details: { maxBytes },
      },
    );
}

function requireEntry(catalog: ReadonlyMap<string, CatalogIssue>, id: string): CatalogIssue {
  const entry = catalog.get(id);
  if (!entry) throw new IssueError(`Issue not found: ${id}`, 'not_found', 'ISSUE_NOT_FOUND', { details: { id } });
  return entry;
}
function assertRevision(entry: CatalogIssue, expected: string): void {
  if (entry.revision !== expected)
    throw new IssueError(`Stale issue revision for ${entry.record.id}.`, 'conflict', 'STALE_REVISION', {
      retryable: true,
      details: { id: entry.record.id, expected, actual: entry.revision },
    });
}
function issuePath(root: string, location: IssueLocation, record: IssueRecord): string {
  return `${root}/${location === 'archive' ? 'archive/' : ''}${issueFilename(record.id, record.title)}`;
}
function proposedEntry(
  root: ManagedRoot,
  record: IssueRecord,
  path: string,
  location: IssueLocation,
  revision = ('v1:' + '0'.repeat(64)) as CatalogIssue['revision'],
): CatalogIssue {
  return {
    record,
    revision,
    byteRevision: ('sha256:' + '0'.repeat(64)) as CatalogIssue['byteRevision'],
    location,
    path: resolveManagedPath(root, path),
    relativePath: path,
    canonical: true,
    size: encodeIssue(record).byteLength,
  };
}
function cloneCatalog(catalog: ReadonlyMap<string, CatalogIssue>): Map<string, CatalogIssue> {
  return new Map([...catalog].map(([id, entry]) => [id, { ...entry, record: structuredClone(entry.record) }]));
}
function linkKey(link: DesignDocumentReference): string {
  return `${link.kind}\0${link.id}\0${link.version ?? ''}`;
}
function matches(
  issue: Issue,
  filters: { status?: IssueStatus; type?: IssueType; assignee?: string; parent?: string; location?: IssueLocation },
): boolean {
  return (
    (!filters.status || issue.status === filters.status) &&
    (!filters.type || issue.type === filters.type) &&
    (!filters.assignee || issue.assigned_to === filters.assignee) &&
    (!filters.parent || issue.parent === filters.parent) &&
    (!filters.location || issue.location === filters.location)
  );
}
function issueOrder(left: Issue, right: Issue): number {
  return right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id);
}
function errorFinding(error: IssueError): IssueValidationReport['findings'][number] {
  return {
    severity: 'error',
    code: error.code,
    message: error.message,
    ...(typeof error.details?.id === 'string' ? { id: error.details.id } : {}),
    ...(typeof error.details?.path === 'string' ? { path: error.details.path } : {}),
    recovery_hint:
      typeof error.details?.recoveryHint === 'string'
        ? error.details.recoveryHint
        : 'Correct canonical YAML or restore it from version control, then validate again.',
  };
}

function report(
  catalog: ReadonlyMap<string, CatalogIssue>,
  findings: IssueValidationReport['findings'],
  cache: IssueValidationReport['cache'],
): IssueValidationReport {
  const values = [...catalog.values()];
  return {
    valid: !findings.some((finding) => finding.severity === 'error'),
    issues: values.length,
    active: values.filter((entry) => entry.location === 'active').length,
    archived: values.filter((entry) => entry.location === 'archive').length,
    findings,
    cache,
  };
}

async function parseImport(
  content: string,
  prefix: string,
  resolver: DesignDocumentReferenceResolver | undefined,
  lease: RepositoryLease,
  control: OperationControl,
): Promise<{ items: Array<{ location: IssueLocation; record: IssueRecord }>; warnings: string[] }> {
  if (Buffer.byteLength(content) > 64 * 1024 * 1024)
    throw new IssueError('Import exceeds 64 MiB.', 'validation', 'IMPORT_TOO_LARGE');
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{')) {
    let parsed: { version?: unknown; issues?: Array<{ location?: unknown; record?: unknown }> };
    try {
      parsed = JSON.parse(content) as typeof parsed;
    } catch (error: unknown) {
      throw new IssueError('Native import is not valid JSON.', 'validation', 'IMPORT_INVALID', { cause: error });
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.issues))
      throw new IssueError('Native import requires version 1 and an issues array.', 'validation', 'IMPORT_INVALID');
    return {
      items: parsed.issues.map((item) => {
        const location = item.location === 'archive' ? 'archive' : item.location === 'active' ? 'active' : undefined;
        if (!location) throw new IssueError('Import issue location must be active or archive.');
        return { location, record: awaitDecode(encodeIssue(item.record as IssueRecord), prefix) };
      }),
      warnings: [],
    };
  }

  // Legacy input is explicit YAML content only; no legacy directory is scanned.
  const documents = parseAllDocuments(content, { uniqueKeys: true, strict: true });
  if (!documents.length || documents.some((document) => document.errors.length))
    throw new IssueError('Legacy import contains malformed YAML.', 'validation', 'IMPORT_INVALID');
  const warnings: string[] = [];
  const items: Array<{ location: IssueLocation; record: IssueRecord }> = [];
  for (const document of documents) {
    const legacy = document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy))
      throw new IssueError('Each legacy YAML document must be an issue mapping.', 'validation', 'IMPORT_INVALID');
    const links: DesignDocumentReference[] = [];
    const documentPaths = Array.isArray(legacy.documents) ? legacy.documents : [];
    for (const path of documentPaths) {
      if (typeof path !== 'string')
        throw new IssueError('Legacy document paths must be strings.', 'validation', 'IMPORT_INVALID');
      if (!resolver?.importLegacyPath)
        throw new IssueError(`Legacy document path is unresolved: ${path}`, 'cross_domain', 'LEGACY_LINK_AMBIGUOUS');
      const reference = await resolver.importLegacyPath(path, { lease, ...control });
      if (!reference)
        throw new IssueError(`Legacy document path is unresolved: ${path}`, 'cross_domain', 'LEGACY_LINK_AMBIGUOUS');
      links.push(reference);
      warnings.push(`Mapped legacy document path ${path} to ${reference.id}.`);
    }
    const comments = Array.isArray(legacy.comments)
      ? legacy.comments.map((comment) => {
          const value = comment as Record<string, unknown>;
          return {
            id: String(value.id),
            author: String(value.author ?? value.created_by),
            body: String(value.body),
            created_at: String(value.created_at),
          };
        })
      : [];
    const candidate: Record<string, unknown> = {
      ...legacy,
      links,
      comments,
      depends_on: legacy.depends_on ?? [],
      relates_to: legacy.relates_to ?? [],
      duplicates: legacy.duplicates ?? [],
      supersedes: legacy.supersedes ?? [],
      metadata: legacy.metadata ?? {},
      body: legacy.body ?? '',
    };
    delete candidate.documents;
    items.push({ location: 'active', record: awaitDecode(encodeIssue(candidate as unknown as IssueRecord), prefix) });
  }
  return { items, warnings };
}

function awaitDecode(bytes: Uint8Array, prefix: string): IssueRecord {
  return decodeImported(bytes, prefix).record;
}
