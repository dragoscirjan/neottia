import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { SearchableError } from './errors.js';
import { normalizeStashUrl, type SearchableImportCandidate } from './stash.js';

interface MigrationWorkerData {
  readonly path: string;
  readonly limits: {
    readonly maxUrlBytes: number;
    readonly maxTitleBytes: number;
    readonly maxContentBytes: number;
    readonly maxStorageBytes: number;
  };
}

interface MigrationWorkerSuccess {
  readonly ok: true;
  readonly rows: readonly SearchableImportCandidate[];
}

interface MigrationWorkerFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

/** Reads the immutable private snapshot away from the host event loop. */
function readRows(input: MigrationWorkerData): readonly SearchableImportCandidate[] {
  const database = new DatabaseSync(input.path, { readOnly: true });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
    if (!integrity || Object.values(integrity)[0] !== 'ok')
      throw new SearchableError('service', 'LEGACY_DATABASE_INVALID', 'The legacy database failed integrity_check.');
    const columns = database.prepare("PRAGMA table_info('pages')").all() as Array<Record<string, unknown>>;
    const names = new Set(columns.map((column) => column['name']));
    if (!['url', 'title', 'content'].every((name) => names.has(name)))
      throw new SearchableError(
        'service',
        'LEGACY_DATABASE_INVALID',
        'The legacy pages table has an unsupported schema.',
      );
    const statement = database.prepare('SELECT url,title,content FROM pages ORDER BY url');
    const rows: SearchableImportCandidate[] = [];
    let aggregate = 0;
    for (const raw of statement.iterate() as Iterable<Record<string, unknown>>) {
      if (rows.length >= 10_000)
        throw new SearchableError(
          'resource_limit',
          'LEGACY_DATABASE_TOO_LARGE',
          'The legacy database has too many pages.',
        );
      if (typeof raw['url'] !== 'string' || typeof raw['title'] !== 'string' || typeof raw['content'] !== 'string')
        throw new SearchableError('service', 'LEGACY_DATABASE_INVALID', 'A legacy page has invalid fields.');
      const row: SearchableImportCandidate = {
        url: normalizeStashUrl(raw['url']),
        title: raw['title'].trim(),
        content: raw['content'],
      };
      if (!row.title || !row.content.trim())
        throw new SearchableError('service', 'LEGACY_DATABASE_INVALID', 'A legacy page has blank title or content.');
      if (Buffer.byteLength(row.url, 'utf8') > input.limits.maxUrlBytes)
        throw tooLarge('A legacy URL exceeds max_url_bytes.');
      if (Buffer.byteLength(row.title, 'utf8') > input.limits.maxTitleBytes)
        throw tooLarge('A legacy title exceeds max_title_bytes.');
      if (Buffer.byteLength(row.content, 'utf8') > input.limits.maxContentBytes)
        throw tooLarge('Legacy content exceeds max_content_bytes.');
      aggregate += Buffer.byteLength(JSON.stringify(row), 'utf8');
      if (aggregate > input.limits.maxStorageBytes) throw tooLarge('Legacy page content exceeds max_storage_bytes.');
      rows.push(row);
    }
    return rows;
  } finally {
    database.close();
  }
}

function tooLarge(message: string): SearchableError {
  return new SearchableError('resource_limit', 'LEGACY_DATABASE_TOO_LARGE', message);
}

try {
  const rows = readRows(workerData as MigrationWorkerData);
  parentPort?.postMessage({ ok: true, rows } satisfies MigrationWorkerSuccess);
} catch (error: unknown) {
  const failure: MigrationWorkerFailure =
    error instanceof SearchableError
      ? { ok: false, code: error.code, message: error.message }
      : { ok: false, code: 'LEGACY_DATABASE_INVALID', message: 'The legacy database could not be read.' };
  parentPort?.postMessage(failure);
}
