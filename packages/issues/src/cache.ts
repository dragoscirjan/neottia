import { createHash } from 'node:crypto';
import {
  LeaseContentionError,
  ResourceLimitError,
  openDisposableSqliteCache,
  rebuildDisposableSqliteCache,
  resolveManagedPath,
  type DisposableCacheSpecification,
  type ManagedRoot,
  type OperationControl,
  type RepositoryLease,
  type SqliteConnection,
} from '@neottia/repository-store';
import type { CatalogIssue } from './catalog.js';
import { compareCodePoints } from './codec.js';
import { IssueError } from './errors.js';
import type { IssueLocation, IssueStatus, IssueType } from './schemas.js';

const APPLICATION_ID = 0x4e495353; // "NISS": Neottia Issues.
const SCHEMA_VERSION = 2;
const MAX_PROJECTION_ROWS = 1_000_000;
const MAX_PROJECTION_BYTES = 256 * 1024 * 1024;

/** Exact filters accepted by ranked issue search. */
export interface IssueSearchFilters {
  readonly status?: IssueStatus;
  readonly type?: IssueType;
  readonly assignee?: string;
  readonly parent?: string;
  readonly location?: IssueLocation;
  readonly limit: number;
  readonly maxBytes: number;
}

/** Ranked cache candidate; callers must hydrate it from canonical YAML. */
export interface IssueSearchCandidate {
  readonly id: string;
  readonly revision: string;
  readonly score: number;
}

/** Stable complete-snapshot digest used to detect stale disposable state. */
export function issueCatalogDigest(catalog: ReadonlyMap<string, CatalogIssue>): string {
  const hash = createHash('sha256');
  for (const [id, entry] of [...catalog].sort(([left], [right]) => compareCodePoints(left, right)))
    hash.update(`${id}\0${entry.relativePath}\0${entry.revision}\n`);
  return hash.digest('hex');
}

/** Opens or atomically rebuilds the domain-owned structured FTS projection. */
export async function ensureIssueCache(
  root: ManagedRoot,
  lease: RepositoryLease,
  catalog: ReadonlyMap<string, CatalogIssue>,
  policy: 'prompt' | 'rebuild' | 'fail',
  maxAgeMs: number,
  verificationMaxRows: number,
  verificationMaxBytes: number,
  control: OperationControl = {},
): Promise<{ cache: SqliteConnection; rebuilt: boolean; close(): Promise<void> }> {
  const specification = cacheSpecification(root, catalog, verificationMaxRows, verificationMaxBytes, control);
  const opened = await openDisposableSqliteCache(root, lease, specification, control);
  if (opened.state === 'ready') {
    let rebuiltAt: { value: string } | undefined;
    try {
      rebuiltAt = await (
        await opened.database.prepare("SELECT value FROM neottia_repository_cache_meta WHERE key='rebuilt_at'")
      ).get<{ value: string }>();
    } catch (error: unknown) {
      // Preserve the probe failure while preventing one leaked handle per retry.
      try {
        await opened.close();
      } catch {
        // The original probe failure remains the actionable cache diagnosis.
      }
      throw error;
    }
    const rebuiltTime = rebuiltAt ? Date.parse(rebuiltAt.value) : Number.NaN;
    const ageMs = Date.now() - rebuiltTime;
    if (Number.isFinite(rebuiltTime) && ageMs >= -300_000 && ageMs <= maxAgeMs)
      return { cache: opened.database, rebuilt: false, close: opened.close };
    await opened.close();
    if (policy === 'fail')
      throw new IssueError(
        'Issues cache exceeds configured max_age_ms and requires rebuild.',
        'storage',
        'ISSUE_CACHE_STALE',
        {
          details: { reason: 'max-age', ageMs: Number.isFinite(ageMs) ? ageMs : 'invalid', maxAgeMs },
        },
      );
  } else if (policy === 'fail') {
    throw new IssueError(
      `Issues cache requires rebuild: ${opened.reason}.`,
      'storage',
      'ISSUE_CACHE_REBUILD_REQUIRED',
      {
        details: { reason: opened.reason },
      },
    );
  }
  const rebuilt = await rebuildDisposableSqliteCache(root, lease, specification, control);
  return { cache: rebuilt.database, rebuilt: true, close: rebuilt.close };
}

/** Runs BM25 over cache candidates without returning cached issue content. */
export async function searchIssueCache(
  database: SqliteConnection,
  query: string,
  filters: IssueSearchFilters,
): Promise<readonly IssueSearchCandidate[]> {
  const conditions = ['issue_fts MATCH ?'];
  const parameters: Array<string | number | null> = [ftsQuery(query)];
  for (const [column, value] of [
    ['status', filters.status],
    ['type', filters.type],
    ['assigned_to', filters.assignee],
    ['parent', filters.parent],
    ['location', filters.location],
  ] as const) {
    if (value !== undefined) {
      conditions.push(`issues.${column} = ?`);
      parameters.push(value);
    }
  }
  parameters.push(filters.limit);
  const sql = `SELECT issues.id, issues.revision, bm25(issue_fts, 0.0, 5.0, 2.0, 1.0, 1.0) AS score FROM issue_fts JOIN issues ON issues.id=issue_fts.issue_id WHERE ${conditions.join(' AND ')} ORDER BY score ASC, issues.updated_at DESC, issues.id ASC LIMIT ?`;
  const statement = await database.prepare(sql);
  return statement.all<IssueSearchCandidate>(parameters, { maxRows: filters.limit, maxBytes: filters.maxBytes });
}

function cacheSpecification(
  root: ManagedRoot,
  catalog: ReadonlyMap<string, CatalogIssue>,
  verificationMaxRows: number,
  verificationMaxBytes: number,
  control: OperationControl,
): DisposableCacheSpecification {
  const projection = projectionRows(catalog);
  assertProjectionBudget(projection);
  return {
    path: resolveManagedPath(root, 'issues.sqlite'),
    applicationId: APPLICATION_ID,
    schemaVersion: SCHEMA_VERSION,
    canonicalDigest: issueCatalogDigest(catalog),
    schemaSql: [
      'CREATE TABLE issues (id TEXT PRIMARY KEY, revision TEXT NOT NULL, location TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT, assigned_to TEXT, parent TEXT)',
      "CREATE VIRTUAL TABLE issue_fts USING fts5(issue_id UNINDEXED, title, body, comments, metadata, tokenize='unicode61')",
      'CREATE TABLE issue_metadata (issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE, value_json TEXT NOT NULL)',
      'CREATE TABLE issue_hierarchy (issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE, parent_id TEXT)',
      'CREATE TABLE issue_relationships (source_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, relationship TEXT NOT NULL, target_id TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(source_id, relationship, ordinal), UNIQUE(source_id, relationship, target_id))',
      'CREATE INDEX issue_relationship_targets ON issue_relationships(target_id, relationship)',
      'CREATE TABLE issue_comments (issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, comment_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(issue_id, ordinal), UNIQUE(issue_id, comment_id))',
      'CREATE TABLE issue_links (issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, kind TEXT NOT NULL, target_id TEXT NOT NULL, target_version INTEGER, version_key TEXT NOT NULL, PRIMARY KEY(issue_id, ordinal), UNIQUE(issue_id, kind, target_id, version_key))',
      'CREATE INDEX issue_link_targets ON issue_links(kind, target_id, target_version)',
      'CREATE TABLE issue_counts (name TEXT PRIMARY KEY, value INTEGER NOT NULL)',
    ],
    async populate(database) {
      await insertRows(
        database,
        'INSERT INTO issues VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        projection.issues,
        issueValues,
      );
      await insertRows(
        database,
        'INSERT INTO issue_fts(issue_id,title,body,comments,metadata) VALUES (?, ?, ?, ?, ?)',
        projection.search,
        searchValues,
      );
      await insertRows(database, 'INSERT INTO issue_metadata VALUES (?, ?)', projection.metadata, objectValues);
      await insertRows(database, 'INSERT INTO issue_hierarchy VALUES (?, ?)', projection.hierarchy, objectValues);
      await insertRows(
        database,
        'INSERT INTO issue_relationships VALUES (?, ?, ?, ?)',
        projection.relationships,
        objectValues,
      );
      await insertRows(
        database,
        'INSERT INTO issue_comments VALUES (?, ?, ?, ?, ?, ?)',
        projection.comments,
        objectValues,
      );
      await insertRows(database, 'INSERT INTO issue_links VALUES (?, ?, ?, ?, ?, ?)', projection.links, objectValues);
      const counts = await database.prepare('INSERT INTO issue_counts VALUES (?, ?)');
      for (const [name, rows] of projectionTables(projection)) await counts.run([name, rows.length]);
    },
    async healthCheck(database) {
      const budget: VerificationBudget = { rows: 0, bytes: 0 };
      for (const [name, rows] of projectionTables(projection)) {
        assertVerificationControl(control);
        const recorded = await (
          await database.prepare('SELECT value FROM issue_counts WHERE name=?')
        ).get<{ value: number }>([name]);
        const actual = await (
          await database.prepare(`SELECT count(*) AS value FROM ${projectionTableName(name)}`)
        ).get<{ value: number }>();
        if (recorded?.value !== rows.length || actual?.value !== rows.length)
          throw new Error(`Issue cache ${name} count contradicts canonical snapshot.`);
      }
      await verifyRows(
        database,
        {
          firstSql:
            'SELECT id,revision,location,type,status,created_at,updated_at,created_by,assigned_to,parent FROM issues ORDER BY id LIMIT ?',
          nextSql:
            'SELECT id,revision,location,type,status,created_at,updated_at,created_by,assigned_to,parent FROM issues WHERE id>? ORDER BY id LIMIT ?',
          keys: ['id'],
        },
        projection.issues,
        verificationMaxRows,
        verificationMaxBytes,
        budget,
        control,
      );
      await verifyRows(
        database,
        {
          firstSql: 'SELECT issue_id,title,body,comments,metadata FROM issue_fts ORDER BY issue_id LIMIT ?',
          nextSql:
            'SELECT issue_id,title,body,comments,metadata FROM issue_fts WHERE issue_id>? ORDER BY issue_id LIMIT ?',
          keys: ['issue_id'],
        },
        projection.search,
        verificationMaxRows,
        verificationMaxBytes,
        budget,
        control,
      );
      await verifyRows(
        database,
        {
          firstSql: 'SELECT issue_id,value_json FROM issue_metadata ORDER BY issue_id LIMIT ?',
          nextSql: 'SELECT issue_id,value_json FROM issue_metadata WHERE issue_id>? ORDER BY issue_id LIMIT ?',
          keys: ['issue_id'],
        },
        projection.metadata,
        verificationMaxRows,
        verificationMaxBytes,
        budget,
        control,
      );
      await verifyRows(
        database,
        {
          firstSql: 'SELECT issue_id,parent_id FROM issue_hierarchy ORDER BY issue_id LIMIT ?',
          nextSql: 'SELECT issue_id,parent_id FROM issue_hierarchy WHERE issue_id>? ORDER BY issue_id LIMIT ?',
          keys: ['issue_id'],
        },
        projection.hierarchy,
        verificationMaxRows,
        verificationMaxBytes,
        budget,
        control,
      );
      await verifyRows(
        database,
        {
          firstSql:
            'SELECT source_id,relationship,target_id,ordinal FROM issue_relationships ORDER BY source_id,relationship,ordinal LIMIT ?',
          nextSql:
            'SELECT source_id,relationship,target_id,ordinal FROM issue_relationships WHERE (source_id,relationship,ordinal)>(?,?,?) ORDER BY source_id,relationship,ordinal LIMIT ?',
          keys: ['source_id', 'relationship', 'ordinal'],
        },
        projection.relationships,
        verificationMaxRows,
        verificationMaxBytes,
        budget,
        control,
      );
      await verifyRows(
        database,
        {
          firstSql:
            'SELECT issue_id,ordinal,comment_id,author,body,created_at FROM issue_comments ORDER BY issue_id,ordinal LIMIT ?',
          nextSql:
            'SELECT issue_id,ordinal,comment_id,author,body,created_at FROM issue_comments WHERE (issue_id,ordinal)>(?,?) ORDER BY issue_id,ordinal LIMIT ?',
          keys: ['issue_id', 'ordinal'],
        },
        projection.comments,
        verificationMaxRows,
        verificationMaxBytes,
        budget,
        control,
      );
      await verifyRows(
        database,
        {
          firstSql:
            'SELECT issue_id,ordinal,kind,target_id,target_version,version_key FROM issue_links ORDER BY issue_id,ordinal LIMIT ?',
          nextSql:
            'SELECT issue_id,ordinal,kind,target_id,target_version,version_key FROM issue_links WHERE (issue_id,ordinal)>(?,?) ORDER BY issue_id,ordinal LIMIT ?',
          keys: ['issue_id', 'ordinal'],
        },
        projection.links,
        verificationMaxRows,
        verificationMaxBytes,
        budget,
        control,
      );
    },
  };
}

interface IssueProjection {
  readonly id: string;
  readonly revision: string;
  readonly location: string;
  readonly type: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: string | null;
  readonly assigned_to: string | null;
  readonly parent: string | null;
}

interface SearchProjection {
  readonly issue_id: string;
  readonly title: string;
  readonly body: string;
  readonly comments: string;
  readonly metadata: string;
}

type ProjectionValue = string | number | null;
type StructuredRow = Readonly<Record<string, ProjectionValue>>;

interface CacheProjection {
  readonly issues: readonly IssueProjection[];
  readonly search: readonly SearchProjection[];
  readonly metadata: readonly StructuredRow[];
  readonly hierarchy: readonly StructuredRow[];
  readonly relationships: readonly StructuredRow[];
  readonly comments: readonly StructuredRow[];
  readonly links: readonly StructuredRow[];
}

function projectionRows(catalog: ReadonlyMap<string, CatalogIssue>): CacheProjection {
  const issues: IssueProjection[] = [];
  const search: SearchProjection[] = [];
  const metadata: StructuredRow[] = [];
  const hierarchy: StructuredRow[] = [];
  const relationships: StructuredRow[] = [];
  const comments: StructuredRow[] = [];
  const links: StructuredRow[] = [];
  for (const [id, entry] of [...catalog].sort(([left], [right]) => compareCodePoints(left, right))) {
    const record = entry.record;
    issues.push({
      id,
      revision: entry.revision,
      location: entry.location,
      type: record.type,
      status: record.status,
      created_at: record.created_at,
      updated_at: record.updated_at,
      created_by: record.created_by ?? null,
      assigned_to: record.assigned_to ?? null,
      parent: record.parent ?? null,
    });
    const searchable = searchProjection(record);
    search.push({ issue_id: id, ...searchable });
    metadata.push({ issue_id: id, value_json: stableJson(record.metadata) });
    hierarchy.push({ issue_id: id, parent_id: record.parent ?? null });
    for (const relationship of ['depends_on', 'relates_to', 'duplicates', 'supersedes'] as const)
      record[relationship].forEach((targetId, ordinal) =>
        relationships.push({ source_id: id, relationship, target_id: targetId, ordinal }),
      );
    record.comments.forEach((comment, ordinal) =>
      comments.push({
        issue_id: id,
        ordinal,
        comment_id: comment.id,
        author: comment.author,
        body: comment.body,
        created_at: comment.created_at,
      }),
    );
    record.links.forEach((link, ordinal) =>
      links.push({
        issue_id: id,
        ordinal,
        kind: link.kind,
        target_id: link.id,
        target_version: link.version ?? null,
        version_key: link.version === undefined ? '' : String(link.version),
      }),
    );
  }
  relationships.sort(
    (left, right) =>
      compareCodePoints(String(left.source_id), String(right.source_id)) ||
      compareCodePoints(String(left.relationship), String(right.relationship)) ||
      Number(left.ordinal) - Number(right.ordinal),
  );
  return { issues, search, metadata, hierarchy, relationships, comments, links };
}

/** Reapplies exact FTS5 semantics while proving the matched projection is canonical. */
export async function issueMatchesSearch(
  database: SqliteConnection,
  issue: CatalogIssue,
  query: string,
  maxBytes: number,
): Promise<boolean> {
  const statement = await database.prepare(
    'SELECT title,body,comments,metadata FROM issue_fts JOIN issues ON issues.id=issue_fts.issue_id WHERE issue_fts MATCH ? AND issues.id=? AND issues.revision=? LIMIT 1',
  );
  const rows = await statement.all<Omit<SearchProjection, 'issue_id'>>(
    [ftsQuery(query), issue.record.id, issue.revision],
    {
      maxRows: 1,
      maxBytes,
    },
  );
  return rows.length === 1 && JSON.stringify(rows[0]) === JSON.stringify(searchProjection(issue.record));
}

function searchProjection(record: CatalogIssue['record']): Omit<SearchProjection, 'issue_id'> {
  return {
    title: record.title,
    body: record.body,
    comments: record.comments.map((comment) => comment.body).join('\n'),
    metadata: searchableMetadata(record.metadata),
  };
}

function projectionTables(projection: CacheProjection): ReadonlyArray<readonly [string, readonly object[]]> {
  return [
    ['issues', projection.issues],
    ['search', projection.search],
    ['metadata', projection.metadata],
    ['hierarchy', projection.hierarchy],
    ['relationships', projection.relationships],
    ['comments', projection.comments],
    ['links', projection.links],
  ];
}

function projectionTableName(name: string): string {
  return name === 'search' ? 'issue_fts' : name === 'issues' ? 'issues' : `issue_${name}`;
}

async function insertRows<T extends object>(
  database: SqliteConnection,
  sql: string,
  rows: readonly T[],
  values: (row: T) => readonly ProjectionValue[],
): Promise<void> {
  const statement = await database.prepare(sql);
  for (const row of rows) await statement.run(values(row));
}

function issueValues(row: IssueProjection): readonly ProjectionValue[] {
  return [
    row.id,
    row.revision,
    row.location,
    row.type,
    row.status,
    row.created_at,
    row.updated_at,
    row.created_by,
    row.assigned_to,
    row.parent,
  ];
}

function searchValues(row: SearchProjection): readonly ProjectionValue[] {
  return [row.issue_id, row.title, row.body, row.comments, row.metadata];
}

function objectValues(row: object): readonly ProjectionValue[] {
  return Object.values(row) as ProjectionValue[];
}

interface VerificationQuery<T extends object> {
  readonly firstSql: string;
  readonly nextSql: string;
  readonly keys: readonly (keyof T)[];
}

interface VerificationBudget {
  rows: number;
  bytes: number;
}

async function verifyRows<T extends object>(
  database: SqliteConnection,
  query: VerificationQuery<T>,
  expected: readonly T[],
  maxRows: number,
  maxBytes: number,
  budget: VerificationBudget,
  control: OperationControl,
): Promise<void> {
  const first = await database.prepare(query.firstSql);
  const next = await database.prepare(query.nextSql);
  let index = 0;
  let previous: T | undefined;
  while (index < expected.length) {
    assertVerificationControl(control);
    const end = verificationPageEnd(expected, index, maxRows, maxBytes);
    const expectedPage = expected.slice(index, end);
    const parameters = [...(previous === undefined ? [] : rowKey(previous, query.keys)), expectedPage.length];
    const actual = await (previous === undefined ? first : next).all<T>(parameters, {
      maxRows: expectedPage.length,
      maxBytes,
    });
    accountVerifiedRows(actual, budget);
    if (JSON.stringify(actual) !== JSON.stringify(expectedPage))
      throw new Error('Issue cache structured projection contradicts canonical snapshot.');
    previous = expectedPage.at(-1) as T;
    index = end;
  }
  assertVerificationControl(control);
  const parameters = [...(previous === undefined ? [] : rowKey(previous, query.keys)), 1];
  const extra = await (previous === undefined ? first : next).all<T>(parameters, { maxRows: 1, maxBytes });
  accountVerifiedRows(extra, budget);
  if (extra.length) throw new Error('Issue cache contains rows absent from canonical authority.');
}

function verificationPageEnd<T extends object>(
  rows: readonly T[],
  start: number,
  maxRows: number,
  maxBytes: number,
): number {
  const byteTarget = Math.max(1, Math.floor(maxBytes / 2));
  let bytes = 0;
  let end = start;
  while (end < rows.length && end - start < Math.min(128, maxRows)) {
    const rowBytes = Buffer.byteLength(JSON.stringify(rows[end]));
    if (end > start && bytes + rowBytes > byteTarget) break;
    bytes += rowBytes;
    end++;
  }
  return end;
}

function rowKey<T extends object>(row: T, keys: readonly (keyof T)[]): readonly ProjectionValue[] {
  const values = row as Readonly<Record<PropertyKey, ProjectionValue>>;
  return keys.map((key) => values[key as PropertyKey]);
}

function accountVerifiedRows(rows: readonly object[], budget: VerificationBudget): void {
  budget.rows += rows.length;
  for (const row of rows) budget.bytes += Buffer.byteLength(JSON.stringify(row));
  if (budget.rows > MAX_PROJECTION_ROWS || budget.bytes > MAX_PROJECTION_BYTES)
    throw new ResourceLimitError('Issue cache verification exceeds its aggregate safety budget.', {
      rows: budget.rows,
      bytes: budget.bytes,
      maxRows: MAX_PROJECTION_ROWS,
      maxBytes: MAX_PROJECTION_BYTES,
    });
}

function assertVerificationControl(control: OperationControl): void {
  if (control.signal?.aborted) throw new LeaseContentionError('Issue cache verification was aborted.', 'ABORTED');
  if (control.deadline !== undefined && Date.now() >= control.deadline)
    throw new LeaseContentionError('Issue cache verification deadline expired.', 'DEADLINE_EXCEEDED');
}

function assertProjectionBudget(projection: CacheProjection): void {
  let rows = 0;
  let bytes = 0;
  for (const [, values] of projectionTables(projection)) {
    rows += values.length;
    for (const value of values) bytes += Buffer.byteLength(JSON.stringify(value));
  }
  if (rows > MAX_PROJECTION_ROWS || bytes > MAX_PROJECTION_BYTES)
    throw new ResourceLimitError('Issue cache projection exceeds its hard safety budget.', {
      rows,
      bytes,
      maxRows: MAX_PROJECTION_ROWS,
      maxBytes: MAX_PROJECTION_BYTES,
    });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function ftsQuery(query: string): string {
  // Quoted terms prevent FTS operators from becoming an injection surface.
  const terms = query
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`);
  return terms.join(' AND ');
}

function searchableMetadata(value: Record<string, unknown>): string {
  const values: string[] = [];
  const visit = (item: unknown): void => {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') values.push(String(item));
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item !== null && typeof item === 'object')
      for (const [key, nested] of Object.entries(item as Record<string, unknown>)) {
        values.push(key);
        visit(nested);
      }
  };
  visit(value);
  return values.join(' ');
}
