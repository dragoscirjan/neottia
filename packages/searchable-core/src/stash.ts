import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  DEFAULT_STORE_LIMITS,
  applyCanonicalBatch,
  computeByteRevision,
  openDisposableSqliteCache,
  rebuildDisposableSqliteCache,
  resolveManagedPath,
  resolveManagedRoot,
  scanManagedFiles,
  withRepositoryLease,
  type ByteRevision,
  type CanonicalOperation,
  type DisposableCacheSpecification,
  type ManagedRoot,
  type OperationControl,
  type RepositoryLease,
  type SqliteConnection,
  type StoreLimits,
} from '@neottia/repository-store';
import { z } from 'zod';
import type { SearchableConfig } from './config.js';
import { SearchableError } from './errors.js';
import {
  checkSearchableDeadline,
  createSearchableDeadline,
  remainingSearchableDeadline,
  shortenSearchableDeadline,
  type SearchableDeadline,
} from './http.js';
import { searchableHttpUrlSchema, webFetchSourceSchema } from './schemas.js';
import type { SearchableOperationContext } from './services.js';
import type { ResolvedSearchableToolInput, SearchableToolOutput } from './tool-contracts.js';
import { truncateUtf8 } from './utf8.js';

const APPLICATION_ID = 0x4e535243; // "NSRC": Neottia Searchable.
const SCHEMA_VERSION = 1;
const STORE_OPERATION_TIMEOUT_MS = 60_000;
/** FTS text, term indexes, SQLite pages, WAL, and rebuild copies get separate space. */
export const SEARCHABLE_CACHE_STORAGE_MULTIPLIER = 8;
/** Small caches still need room for SQLite schema and journal pages. */
export const SEARCHABLE_CACHE_FIXED_BYTES = 8 * 1024 * 1024;
const pageRecordSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^page-[0-9a-f]{64}$/u),
    url: searchableHttpUrlSchema,
    title: z.string().min(1),
    content: z.string().min(1),
    excerpt: z.string().optional(),
    site_name: z.string().optional(),
    source: webFetchSourceSchema.optional(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

/** Canonical page persisted below the configured Searchable root. */
export type StashedPageRecord = z.infer<typeof pageRecordSchema>;
interface CatalogPage {
  readonly record: StashedPageRecord;
  readonly revision: ByteRevision;
  readonly relativePath: string;
}

interface StoreOperationControl extends OperationControl {
  readonly monotonicDeadline: SearchableDeadline;
  readonly sourceSignal?: AbortSignal;
}

/** Validation result for canonical pages and the disposable FTS cache. */
export interface SearchableValidationReport {
  readonly valid: boolean;
  readonly pages: number;
  readonly cache: 'checked' | 'rebuilt';
  readonly errors: readonly string[];
}

/** Validated legacy page fields accepted by the atomic migration seam. */
export interface SearchableImportCandidate {
  readonly url: string;
  readonly title: string;
  readonly content: string;
}

/** Canonical migration plan or apply result. */
export interface SearchableImportResult {
  readonly planned: number;
  readonly imported: number;
  readonly conflicts: readonly string[];
  readonly existing: readonly string[];
  readonly warnings: readonly string[];
}

/** Filesystem-canonical stash with an authority-checked disposable FTS cache. */
export class SearchableStore {
  private rootPromise?: Promise<ManagedRoot>;
  private cacheRootPromise?: Promise<ManagedRoot>;

  public constructor(
    public readonly config: SearchableConfig,
    public readonly cwd: string,
  ) {}

  /** Creates a store from already resolved configuration. */
  public static fromConfig(config: SearchableConfig, cwd: string): SearchableStore {
    return new SearchableStore(config, cwd);
  }

  /** Creates or replaces one canonical page by normalized URL identity. */
  public async stash(
    input: ResolvedSearchableToolInput<'web_stash'>,
    context?: SearchableOperationContext,
  ): Promise<SearchableToolOutput<'web_stash'>> {
    this.assertEnabled();
    const normalizedUrl = normalizeStashUrl(input.url);
    const id = pageId(normalizedUrl);
    const control = operationControl(context);
    await this.withCatalog(async (root, lease, catalog) => {
      const current = catalog.get(id);
      const now = new Date().toISOString();
      const record: StashedPageRecord = {
        version: 1,
        id,
        url: normalizedUrl,
        title: input.title,
        content: input.content,
        ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
        ...(input.siteName === undefined ? {} : { site_name: input.siteName }),
        ...(input.source === undefined ? {} : { source: input.source }),
        created_at: current?.record.created_at ?? now,
        updated_at: current && samePage(current.record, input, normalizedUrl) ? current.record.updated_at : now,
      };
      const bytes = encodePage(record);
      const path = `${this.config.root}/pages/${id}.json`;
      if (current && Buffer.from(bytes).equals(Buffer.from(encodePage(current.record)))) return;
      const proposed = new Map(catalog);
      proposed.set(id, { record, revision: computeByteRevision(bytes), relativePath: path });
      validateCatalog(proposed, this.config);
      const operation: CanonicalOperation = {
        kind: 'write',
        path: resolveManagedPath(root, path),
        bytes,
        expected: current?.revision ?? 'absent',
      };
      await applyCanonicalBatch(root, lease, [operation], {
        ...control,
        inventory: [resolveManagedPath(root, this.config.root), resolveManagedPath(root, `${this.config.root}/pages`)],
      });
    }, control);
    return { stashed: true, url: normalizedUrl };
  }

  /** Plans or atomically applies legacy pages without replacing canonical records. */
  public async importPages(
    candidates: readonly SearchableImportCandidate[],
    preview: boolean,
    context?: SearchableOperationContext,
  ): Promise<SearchableImportResult> {
    this.assertEnabled();
    const control = operationControl(context);
    return this.withCatalog(async (root, lease, catalog) => {
      const proposed = new Map(catalog);
      const operations: CanonicalOperation[] = [];
      const conflicts: string[] = [];
      const existing: string[] = [];
      const now = new Date().toISOString();
      for (const candidate of candidates) {
        const url = normalizeStashUrl(candidate.url);
        const id = pageId(url);
        const current = catalog.get(id);
        if (current) {
          if (
            current.record.url === url &&
            current.record.title === candidate.title &&
            current.record.content === candidate.content
          )
            existing.push(id);
          else conflicts.push(id);
          continue;
        }
        const record: StashedPageRecord = {
          version: 1,
          id,
          url,
          title: candidate.title,
          content: candidate.content,
          created_at: now,
          updated_at: now,
        };
        const bytes = encodePage(record);
        const relativePath = `${this.config.root}/pages/${id}.json`;
        proposed.set(id, { record, revision: computeByteRevision(bytes), relativePath });
        operations.push({ kind: 'write', path: resolveManagedPath(root, relativePath), bytes, expected: 'absent' });
      }
      validateCatalog(proposed, this.config);
      if (conflicts.length || preview)
        return { planned: operations.length, imported: 0, conflicts, existing, warnings: [] };
      if (operations.length)
        await applyCanonicalBatch(root, lease, operations, {
          ...control,
          inventory: [
            resolveManagedPath(root, this.config.root),
            resolveManagedPath(root, `${this.config.root}/pages`),
          ],
        });
      const warnings: string[] = [];
      if (operations.length)
        try {
          const rebuilt = await rebuildDisposableSqliteCache(
            await this.cacheRoot(),
            lease,
            cacheSpecification(await this.cacheRoot(), proposed, control),
            control,
          );
          await rebuilt.close();
        } catch {
          warnings.push('Canonical pages were imported, but the disposable search cache requires a later rebuild.');
        }
      return { planned: operations.length, imported: operations.length, conflicts, existing, warnings };
    }, control);
  }

  /** Runs literal-term FTS and hydrates every returned field from canonical JSON. */
  public async grep(
    input: ResolvedSearchableToolInput<'web_grep'>,
    context?: SearchableOperationContext,
  ): Promise<SearchableToolOutput<'web_grep'>> {
    this.assertEnabled();
    const terms = queryTerms(input.query);
    const control = operationControl(context);
    return this.withCatalog(async (root, lease, catalog) => {
      const handle = await this.ensureCache(await this.cacheRoot(), lease, catalog, context, control);
      try {
        const statement = await handle.database.prepare(
          'SELECT pages.id,pages.revision,bm25(page_fts,5.0,1.0) AS rank FROM page_fts JOIN pages ON pages.id=page_fts.page_id WHERE page_fts MATCH ? ORDER BY rank ASC,pages.id ASC LIMIT ?',
        );
        const candidates = await statement.all<{ id: string; revision: string; rank: number }>(
          [ftsExpression(terms), input.limit],
          { maxRows: input.limit, maxBytes: this.config.security.limits.max_result_bytes },
        );
        const refreshed = await loadCatalog(root, lease, this.config, control);
        return {
          results: candidates.flatMap((candidate) => {
            const page = refreshed.get(candidate.id);
            if (!page || page.revision !== candidate.revision || !matches(page.record, terms)) return [];
            return [
              {
                url: page.record.url,
                title: page.record.title,
                snippet: canonicalSnippet(page.record, terms, this.config.grep.snippet_bytes),
                rank: candidate.rank,
              },
            ];
          }),
        };
      } finally {
        await handle.close();
      }
    }, control);
  }

  /** Returns canonical context records in the same deterministic rank order as grep. */
  public async context(
    input: ResolvedSearchableToolInput<'web_ask'>,
    context?: SearchableOperationContext,
  ): Promise<readonly StashedPageRecord[]> {
    const results = await this.grep({ query: input.question, limit: input.limit }, context);
    const wanted = new Set(results.results.map((result) => result.url));
    const terms = queryTerms(input.question);
    const contentBytes = Math.max(256, Math.floor(this.config.ask.context_bytes / Math.max(1, results.results.length)));
    const control = operationControl(context);
    return this.withCatalog(
      async (_root, _lease, catalog) =>
        results.results.flatMap((result) => {
          const page = [...catalog.values()].find((entry) => entry.record.url === result.url && wanted.has(result.url));
          return page ? [{ ...page.record, content: canonicalContext(page.record, terms, contentBytes) }] : [];
        }),
      control,
    );
  }

  /** Checks every canonical page and verifies or rebuilds its cache. */
  public async validate(context?: SearchableOperationContext): Promise<SearchableValidationReport> {
    const control = operationControl(context);
    return this.withCatalog(async (_root, lease, catalog) => {
      const handle = await this.ensureCache(await this.cacheRoot(), lease, catalog, context, control);
      try {
        return { valid: true, pages: catalog.size, cache: handle.rebuilt ? 'rebuilt' : 'checked', errors: [] };
      } finally {
        await handle.close();
      }
    }, control);
  }

  private async ensureCache(
    root: ManagedRoot,
    lease: RepositoryLease,
    catalog: ReadonlyMap<string, CatalogPage>,
    context: SearchableOperationContext | undefined,
    control: StoreOperationControl,
  ): Promise<{ database: SqliteConnection; rebuilt: boolean; close(): Promise<void> }> {
    const specification = cacheSpecification(root, catalog, control);
    const opened = await openDisposableSqliteCache(root, lease, specification, control);
    let reason: string;
    if (opened.state === 'ready') {
      let fresh = false;
      try {
        const rebuiltAt = await (
          await opened.database.prepare("SELECT value FROM neottia_repository_cache_meta WHERE key='rebuilt_at'")
        ).get<{ value: string }>();
        const age = Date.now() - Date.parse(rebuiltAt?.value ?? '');
        fresh = Number.isFinite(age) && age >= -300_000 && age <= this.config.cache.max_age_ms;
        if (fresh) return { database: opened.database, rebuilt: false, close: opened.close };
        reason = 'stale';
      } finally {
        if (!fresh) await opened.close();
      }
    } else {
      reason = opened.reason;
    }
    let policy = this.config.cache.stale_policy;
    if (policy === 'prompt') policy = (await context?.onStaleCache?.()) === false ? 'fail' : 'rebuild';
    if (policy === 'fail') {
      if (reason === 'stale') throw cacheError('STASH_CACHE_STALE', 'The Searchable cache exceeds max_age_ms.');
      throw cacheError('STASH_CACHE_REBUILD_REQUIRED', `The Searchable cache requires rebuild: ${reason}.`);
    }
    const rebuilt = await rebuildDisposableSqliteCache(root, lease, specification, control);
    return { database: rebuilt.database, rebuilt: true, close: rebuilt.close };
  }

  private async withCatalog<T>(
    operation: (root: ManagedRoot, lease: RepositoryLease, catalog: Map<string, CatalogPage>) => Promise<T>,
    control: StoreOperationControl,
  ): Promise<T> {
    const root = await this.root();
    try {
      return await withRepositoryLease(
        root,
        async (lease) => operation(root, lease, await loadCatalog(root, lease, this.config, control)),
        control,
      );
    } catch (error: unknown) {
      if (error instanceof SearchableError) throw error;
      if (control.sourceSignal?.aborted)
        throw new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable operation was cancelled.');
      try {
        checkSearchableDeadline(control.monotonicDeadline);
      } catch {
        throw new SearchableError('service', 'DEADLINE_EXCEEDED', 'The Searchable operation exceeded its deadline.');
      }
      throw new SearchableError('service', 'STASH_STORAGE_FAILED', 'Searchable canonical storage failed.');
    }
  }

  private root(): Promise<ManagedRoot> {
    this.rootPromise ??= resolveManagedRoot({ authorityRoot: resolve(this.cwd), limits: storeLimits(this.config) });
    return this.rootPromise;
  }

  private cacheRoot(): Promise<ManagedRoot> {
    this.cacheRootPromise ??= resolveManagedRoot({
      authorityRoot: resolve(this.cwd),
      managedPath: '.neottia/cache',
      limits: cacheStoreLimits(this.config),
    });
    return this.cacheRootPromise;
  }

  private assertEnabled(): void {
    if (!this.config.enabled)
      throw new SearchableError(
        'configuration',
        'CAPABILITY_DISABLED',
        'Searchable requires skills.searchable.enabled=true.',
      );
  }
}

/** Normalizes stable URL identity without changing path or query semantics. */
export function normalizeStashUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new SearchableError(
      'validation',
      'STASH_URL_INVALID',
      'Stash URLs must use HTTP(S) without user information.',
    );
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))
    url.port = '';
  return url.href;
}

/** Stable page identity derived only from the normalized URL. */
export function pageId(normalizedUrl: string): `page-${string}` {
  return `page-${createHash('sha256').update(normalizedUrl).digest('hex')}`;
}

/** Deterministic JSON encoding used as repository authority. */
export function encodePage(record: StashedPageRecord): Uint8Array {
  const ordered = {
    version: record.version,
    id: record.id,
    url: record.url,
    title: record.title,
    content: record.content,
    ...(record.excerpt === undefined ? {} : { excerpt: record.excerpt }),
    ...(record.site_name === undefined ? {} : { site_name: record.site_name }),
    ...(record.source === undefined ? {} : { source: record.source }),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
  return Buffer.from(`${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

async function loadCatalog(
  root: ManagedRoot,
  lease: RepositoryLease,
  config: SearchableConfig,
  control: StoreOperationControl,
): Promise<Map<string, CatalogPage>> {
  const files = await scanManagedFiles(root, lease, {
    ...control,
    under: [resolveManagedPath(root, `${config.root}/pages`)],
    accept: (path) => path.endsWith('.json'),
  });
  const catalog = new Map<string, CatalogPage>();
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(file.bytes).toString('utf8')) as unknown;
    } catch {
      throw new SearchableError(
        'service',
        'STASH_RECORD_INVALID',
        'A canonical Searchable page contains invalid JSON.',
      );
    }
    const record = pageRecordSchema.parse(parsed);
    if (pageId(normalizeStashUrl(record.url)) !== record.id || !file.path.relativePath.endsWith(`/${record.id}.json`))
      throw new SearchableError(
        'service',
        'STASH_RECORD_INVALID',
        'A canonical Searchable page has inconsistent identity.',
      );
    if (catalog.has(record.id))
      throw new SearchableError(
        'service',
        'STASH_RECORD_INVALID',
        'Canonical Searchable pages contain a duplicate identity.',
      );
    catalog.set(record.id, { record, revision: file.revision, relativePath: file.path.relativePath });
  }
  validateCatalog(catalog, config);
  return catalog;
}

function cacheSpecification(
  root: ManagedRoot,
  catalog: ReadonlyMap<string, CatalogPage>,
  control: StoreOperationControl,
): DisposableCacheSpecification {
  const rows = [...catalog.values()].sort((left, right) => left.record.id.localeCompare(right.record.id));
  return {
    path: resolveManagedPath(root, 'searchable.sqlite'),
    applicationId: APPLICATION_ID,
    schemaVersion: SCHEMA_VERSION,
    canonicalDigest: catalogDigest(catalog),
    schemaSql: [
      'CREATE TABLE pages (id TEXT PRIMARY KEY, revision TEXT NOT NULL)',
      "CREATE VIRTUAL TABLE page_fts USING fts5(page_id UNINDEXED,title,content,tokenize='unicode61')",
    ],
    async populate(database) {
      const pages = await database.prepare('INSERT INTO pages VALUES (?,?)');
      const fts = await database.prepare('INSERT INTO page_fts(page_id,title,content) VALUES (?,?,?)');
      for (const row of rows) {
        checkStoreControl(control);
        await pages.run([row.record.id, row.revision]);
        await fts.run([row.record.id, row.record.title, row.record.content]);
      }
    },
    async healthCheck(database) {
      const count = await (await database.prepare('SELECT count(*) AS value FROM pages')).get<{ value: number }>();
      const ftsCount = await (
        await database.prepare('SELECT count(*) AS value FROM page_fts')
      ).get<{ value: number }>();
      if (count?.value !== rows.length || ftsCount?.value !== rows.length)
        throw new Error('Searchable cache row count contradicts canonical state.');
      const projected = await database.prepare(
        'SELECT pages.id,pages.revision,page_fts.title,page_fts.content FROM pages JOIN page_fts ON pages.id=page_fts.page_id WHERE pages.id>? ORDER BY pages.id LIMIT 1',
      );
      let previous = '';
      for (const expected of rows) {
        checkStoreControl(control);
        const actual = await projected.get<{ id: string; revision: string; title: string; content: string }>([
          previous,
        ]);
        if (
          !actual ||
          actual.id !== expected.record.id ||
          actual.revision !== expected.revision ||
          actual.title !== expected.record.title ||
          actual.content !== expected.record.content
        )
          throw new Error('Searchable cache content contradicts canonical state.');
        previous = actual.id;
      }
    },
  };
}

function catalogDigest(catalog: ReadonlyMap<string, CatalogPage>): string {
  const hash = createHash('sha256');
  for (const [id, value] of [...catalog].sort(([left], [right]) => left.localeCompare(right)))
    hash.update(`${id}\0${value.relativePath}\0${value.revision}\n`);
  return hash.digest('hex');
}

function validateCatalog(catalog: ReadonlyMap<string, CatalogPage>, config: SearchableConfig): void {
  let total = 0;
  for (const page of catalog.values()) {
    const size = encodePage(page.record).byteLength;
    if (size > config.security.limits.max_content_bytes + 64 * 1024)
      throw new SearchableError('resource_limit', 'STASH_RECORD_TOO_LARGE', 'A canonical page exceeds its byte limit.');
    total += size;
  }
  if (total > config.security.limits.max_storage_bytes)
    throw new SearchableError(
      'resource_limit',
      'STASH_STORAGE_LIMIT',
      'Canonical Searchable pages exceed max_storage_bytes.',
    );
}

function storeLimits(config: SearchableConfig): StoreLimits {
  const maxFile = config.security.limits.max_content_bytes + config.security.limits.max_title_bytes + 128 * 1024;
  return storeLimitsForBytes(config, maxFile, config.security.limits.max_storage_bytes);
}

/** Gives the disposable FTS cache a bound independent of canonical authority. */
function cacheStoreLimits(config: SearchableConfig): StoreLimits {
  const maximum =
    config.security.limits.max_storage_bytes * SEARCHABLE_CACHE_STORAGE_MULTIPLIER + SEARCHABLE_CACHE_FIXED_BYTES;
  return storeLimitsForBytes(config, maximum, maximum);
}

function storeLimitsForBytes(config: SearchableConfig, maxFile: number, maxTotalBytes: number): StoreLimits {
  const projectionBytes =
    config.security.limits.max_content_bytes + config.security.limits.max_title_bytes + 128 * 1024;
  return {
    ...DEFAULT_STORE_LIMITS,
    maxFileBytes: maxFile,
    maxFiles: 10_000,
    maxBatchPaths: 10_000,
    maxTotalBytes,
    maxBeforeImageBytes: maxTotalBytes,
    maxTemporaryBytes: maxTotalBytes,
    maxStatementParameterBytes: Math.max(DEFAULT_STORE_LIMITS.maxStatementParameterBytes, projectionBytes),
    maxQueryRows: Math.max(DEFAULT_STORE_LIMITS.maxQueryRows, config.security.limits.max_results),
    maxQueryResultBytes: Math.max(config.security.limits.max_result_bytes, projectionBytes),
  };
}

function queryTerms(query: string): readonly string[] {
  const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 32) ?? [];
  if (!terms.length)
    throw new SearchableError('validation', 'QUERY_INVALID', 'Search requires at least one letter or number.');
  return terms;
}

function ftsExpression(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
}

function matches(record: StashedPageRecord, terms: readonly string[]): boolean {
  const haystack = `${record.title}\n${record.content}`.toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term.toLocaleLowerCase()));
}

function canonicalSnippet(record: StashedPageRecord, terms: readonly string[], maximumBytes: number): string {
  return canonicalContext(record, terms, maximumBytes, 80);
}

/** Selects a bounded canonical window around the earliest query term. */
function canonicalContext(
  record: StashedPageRecord,
  terms: readonly string[],
  maximumBytes: number,
  leadingCharacters = 256,
): string {
  const lower = record.content.toLocaleLowerCase();
  const indices = terms.map((term) => lower.indexOf(term.toLocaleLowerCase())).filter((index) => index >= 0);
  const start = Math.max(0, (indices.length ? Math.min(...indices) : 0) - leadingCharacters);
  return truncateUtf8(record.content.slice(start), maximumBytes);
}

function samePage(
  current: StashedPageRecord,
  input: ResolvedSearchableToolInput<'web_stash'>,
  normalizedUrl: string,
): boolean {
  return (
    current.url === normalizedUrl &&
    current.title === input.title &&
    current.content === input.content &&
    current.excerpt === input.excerpt &&
    current.site_name === input.siteName &&
    current.source === input.source
  );
}

function operationControl(context?: SearchableOperationContext): StoreOperationControl {
  const requestedDeadline = createSearchableDeadline(STORE_OPERATION_TIMEOUT_MS, context?.deadline);
  const monotonicDeadline = context?.transportDeadline
    ? {
        expiresAt: Math.min(
          shortenSearchableDeadline(context.transportDeadline, STORE_OPERATION_TIMEOUT_MS).expiresAt,
          requestedDeadline.expiresAt,
        ),
      }
    : requestedDeadline;
  checkSearchableDeadline(monotonicDeadline, context?.signal);
  const deadlineSignal = AbortSignal.timeout(Math.ceil(remainingSearchableDeadline(monotonicDeadline)));
  const signal = context?.signal ? AbortSignal.any([context.signal, deadlineSignal]) : deadlineSignal;
  return {
    signal,
    monotonicDeadline,
    ...(context?.signal === undefined ? {} : { sourceSignal: context.signal }),
  };
}

/** Stops bounded cache loops between synchronous SQLite calls. */
function checkStoreControl(control: StoreOperationControl): void {
  if (control.sourceSignal?.aborted)
    throw new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable operation was cancelled.');
  try {
    checkSearchableDeadline(control.monotonicDeadline);
  } catch {
    throw new SearchableError('service', 'DEADLINE_EXCEEDED', 'The Searchable operation exceeded its deadline.');
  }
}

function cacheError(code: string, message: string): SearchableError {
  return new SearchableError('service', code, message);
}
