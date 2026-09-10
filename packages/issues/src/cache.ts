import { createHash } from 'node:crypto';
import {
  openDisposableSqliteCache,
  rebuildDisposableSqliteCache,
  resolveManagedPath,
  type DisposableCacheSpecification,
  type ManagedRoot,
  type RepositoryLease,
  type OperationControl,
  type SqliteConnection,
} from '@neottia/repository-store';
import type { CatalogIssue } from './catalog.js';
import { compareCodePoints } from './codec.js';
import type { IssueLocation, IssueStatus, IssueType } from './schemas.js';

const APPLICATION_ID = 0x4e495353; // "NISS": Neottia Issues.
const SCHEMA_VERSION = 1;

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

/** Opens or atomically rebuilds the domain-owned FTS5 projection. */
export async function ensureIssueCache(
  root: ManagedRoot,
  lease: RepositoryLease,
  catalog: ReadonlyMap<string, CatalogIssue>,
  policy: 'prompt' | 'rebuild' | 'fail',
  maxAgeMs: number,
  verificationMaxBytes: number,
  control: OperationControl = {},
): Promise<{ cache: SqliteConnection; rebuilt: boolean; close(): Promise<void> }> {
  const specification = cacheSpecification(root, catalog, verificationMaxBytes);
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
    const age = Date.now() - rebuiltTime;
    if (Number.isFinite(rebuiltTime) && age >= -300_000 && age <= maxAgeMs)
      return { cache: opened.database, rebuilt: false, close: opened.close };
    await opened.close();
    if (policy === 'fail') throw new Error('Issues cache exceeds configured max_age_ms.');
  } else if (policy === 'fail') throw new Error(`Issues cache requires rebuild: ${opened.reason}.`);
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
  verificationMaxBytes: number,
): DisposableCacheSpecification {
  return {
    path: resolveManagedPath(root, 'issues.sqlite'),
    applicationId: APPLICATION_ID,
    schemaVersion: SCHEMA_VERSION,
    canonicalDigest: issueCatalogDigest(catalog),
    schemaSql: [
      'CREATE TABLE issues (id TEXT PRIMARY KEY, revision TEXT NOT NULL, location TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, assigned_to TEXT, parent TEXT, updated_at TEXT NOT NULL)',
      "CREATE VIRTUAL TABLE issue_fts USING fts5(issue_id UNINDEXED, title, body, comments, metadata, tokenize='unicode61')",
      'CREATE TABLE issue_counts (name TEXT PRIMARY KEY, value INTEGER NOT NULL)',
    ],
    async populate(database) {
      const issueInsert = await database.prepare('INSERT INTO issues VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const ftsInsert = await database.prepare(
        'INSERT INTO issue_fts(issue_id,title,body,comments,metadata) VALUES (?, ?, ?, ?, ?)',
      );
      for (const row of projectionRows(catalog)) {
        await issueInsert.run([
          row.id,
          row.revision,
          row.location,
          row.type,
          row.status,
          row.assigned_to,
          row.parent,
          row.updated_at,
        ]);
        await ftsInsert.run([row.id, row.title, row.body, row.comments, row.metadata]);
      }
      await (await database.prepare('INSERT INTO issue_counts VALUES (?, ?)')).run(['issues', catalog.size]);
    },
    async healthCheck(database) {
      const count = await (
        await database.prepare('SELECT value FROM issue_counts WHERE name=?')
      ).get<{ value: number }>(['issues']);
      const actual = await (await database.prepare('SELECT count(*) AS value FROM issues')).get<{ value: number }>();
      if (count?.value !== catalog.size || actual?.value !== catalog.size)
        throw new Error('Issue cache count contradicts canonical snapshot.');
      const expectedRows = projectionRows(catalog);
      const projection = await database.prepare(
        'SELECT issues.id,revision,location,type,status,assigned_to,parent,updated_at,title,body,comments,metadata FROM issues JOIN issue_fts ON issues.id=issue_fts.issue_id ORDER BY issues.id LIMIT 1 OFFSET ?',
      );
      // Verify complete rows incrementally so a valid aggregate cannot exceed one query budget.
      for (const [index, expected] of expectedRows.entries()) {
        const rows = await projection.all<ProjectionRow>([index], { maxRows: 1, maxBytes: verificationMaxBytes });
        if (rows.length !== 1 || JSON.stringify(rows[0]) !== JSON.stringify(expected))
          throw new Error('Issue cache searchable/filter projection contradicts canonical snapshot.');
      }
      const extra = await projection.all<ProjectionRow>([expectedRows.length], {
        maxRows: 1,
        maxBytes: verificationMaxBytes,
      });
      if (extra.length) throw new Error('Issue cache contains records absent from canonical authority.');
    },
  };
}

interface SearchProjection {
  readonly title: string;
  readonly body: string;
  readonly comments: string;
  readonly metadata: string;
}

interface ProjectionRow extends SearchProjection {
  readonly id: string;
  readonly revision: string;
  readonly location: string;
  readonly type: string;
  readonly status: string;
  readonly assigned_to: string | null;
  readonly parent: string | null;
  readonly updated_at: string;
}

function projectionRows(catalog: ReadonlyMap<string, CatalogIssue>): readonly ProjectionRow[] {
  return [...catalog]
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([id, entry]) => ({
      id,
      revision: entry.revision,
      location: entry.location,
      type: entry.record.type,
      status: entry.record.status,
      assigned_to: entry.record.assigned_to ?? null,
      parent: entry.record.parent ?? null,
      updated_at: entry.record.updated_at,
      ...searchProjection(entry.record),
    }));
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
  const rows = await statement.all<SearchProjection>([ftsQuery(query), issue.record.id, issue.revision], {
    maxRows: 1,
    maxBytes,
  });
  return rows.length === 1 && JSON.stringify(rows[0]) === JSON.stringify(searchProjection(issue.record));
}

function searchProjection(record: CatalogIssue['record']): SearchProjection {
  return {
    title: record.title,
    body: record.body,
    comments: record.comments.map((comment) => comment.body).join('\n'),
    metadata: searchableMetadata(record.metadata),
  };
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
