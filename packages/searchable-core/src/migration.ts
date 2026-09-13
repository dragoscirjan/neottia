import { constants, existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { SearchableError } from './errors.js';
import {
  checkSearchableDeadline,
  createSearchableDeadline,
  remainingSearchableDeadline,
  type SearchableDeadline,
} from './http.js';
import type { SearchableOperationContext } from './services.js';
import { pageId, type SearchableImportCandidate, type SearchableStore } from './stash.js';
import { runBoundedWorker } from './worker.js';

const MIGRATION_TIMEOUT_MS = 60_000;
const COPY_CHUNK_BYTES = 64 * 1024;

/** Explicit preview-first import options for the legacy .web_stash.db file. */
export interface LegacyImportOptions {
  readonly path: string;
  readonly preview?: boolean;
  readonly signal?: AbortSignal;
  /** Absolute Unix epoch deadline for snapshot and validation work. */
  readonly deadline?: number;
}

/** Bounded migration report. The legacy database is never modified. */
export interface LegacyImportReport {
  readonly preview: boolean;
  readonly valid: boolean;
  readonly planned: number;
  readonly imported: number;
  readonly conflicts: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

interface LegacyIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

interface MigrationWorkerMessage {
  readonly ok: boolean;
  readonly rows?: readonly SearchableImportCandidate[];
  readonly code?: string;
  readonly message?: string;
}

/** Imports only legacy pages after a safe immutable snapshot and integrity check. */
export async function importLegacySearchableDatabase(
  store: SearchableStore,
  options: LegacyImportOptions,
  context?: SearchableOperationContext,
): Promise<LegacyImportReport> {
  const preview = options.preview ?? true;
  const signal = options.signal ?? context?.signal;
  const epochDeadline = options.deadline ?? context?.deadline;
  const requestedDeadline = createSearchableDeadline(MIGRATION_TIMEOUT_MS, epochDeadline);
  const deadline = context?.transportDeadline
    ? { expiresAt: Math.min(context.transportDeadline.expiresAt, requestedDeadline.expiresAt) }
    : requestedDeadline;
  let source: FileHandle | undefined;
  try {
    checkControl(signal, deadline);
    const path = projectPath(store.cwd, options.path);
    source = await openLegacySource(path);
    const identity = await safeLegacyIdentity(source, store.config.security.limits.max_storage_bytes);
    await assertSourceIdentity(source, path, identity);
    rejectSidecars(path);
    const directory = mkdtempSync(resolve(tmpdir(), 'neottia-searchable-import-'));
    const snapshot = resolve(directory, 'legacy.sqlite');
    try {
      await copyLegacySnapshot(source, snapshot, store.config.security.limits.max_storage_bytes, signal, deadline);
      await assertSourceIdentity(source, path, identity);
      const rows = await readLegacyRows(snapshot, store.config, signal, deadline);
      const duplicates = duplicateUrls(rows);
      if (duplicates.length)
        return report(
          preview,
          false,
          rows.length,
          0,
          duplicates,
          [],
          ['The legacy database contains duplicate normalized URLs.'],
        );
      await assertSourceIdentity(source, path, identity);
      const imported = await store.importPages(rows, preview, {
        cwd: context?.cwd ?? store.cwd,
        config: context?.config ?? store.config,
        ...(signal === undefined ? {} : { signal }),
        ...(epochDeadline === undefined ? {} : { deadline: epochDeadline }),
        transportDeadline: deadline,
        ...(context?.onStaleCache === undefined ? {} : { onStaleCache: context.onStaleCache }),
      });
      return report(
        preview,
        imported.conflicts.length === 0,
        imported.planned,
        imported.imported,
        imported.conflicts,
        [
          ...imported.warnings,
          ...(imported.existing.length
            ? [`${imported.existing.length} legacy page(s) already match canonical records.`]
            : []),
        ],
        imported.conflicts.length ? ['Canonical conflicts must be resolved before import.'] : [],
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  } catch (error: unknown) {
    return report(
      preview,
      false,
      0,
      0,
      [],
      [],
      [error instanceof SearchableError ? error.message : 'Legacy import failed.'],
    );
  } finally {
    await source?.close();
  }
}

/** Opens one descriptor without following a replacement symlink. */
async function openLegacySource(path: string): Promise<FileHandle> {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new SearchableError(
      'service',
      'LEGACY_PATH_UNSAFE',
      'The legacy database must be a regular singly-linked file.',
    );
  }
}

async function safeLegacyIdentity(source: FileHandle, maximumBytes: number): Promise<LegacyIdentity> {
  const stat = await source.stat();
  if (!stat.isFile() || stat.nlink !== 1)
    throw new SearchableError(
      'service',
      'LEGACY_PATH_UNSAFE',
      'The legacy database must be a regular singly-linked file.',
    );
  if (stat.size > maximumBytes)
    throw new SearchableError(
      'resource_limit',
      'LEGACY_DATABASE_TOO_LARGE',
      'The legacy database exceeds max_storage_bytes.',
    );
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

/** Copies from the verified descriptor in cancellable bounded chunks. */
async function copyLegacySnapshot(
  source: FileHandle,
  destinationPath: string,
  maximumBytes: number,
  signal: AbortSignal | undefined,
  deadline: SearchableDeadline,
): Promise<void> {
  const destination = await open(destinationPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  let offset = 0;
  try {
    while (true) {
      checkControl(signal, deadline);
      const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      if (offset > maximumBytes)
        throw new SearchableError(
          'resource_limit',
          'LEGACY_DATABASE_TOO_LARGE',
          'The legacy database exceeds max_storage_bytes.',
        );
      let written = 0;
      while (written < bytesRead) {
        checkControl(signal, deadline);
        const result = await destination.write(buffer, written, bytesRead - written, offset - bytesRead + written);
        written += result.bytesWritten;
      }
    }
    await destination.sync();
  } finally {
    await destination.close();
  }
}

/** Rejects descriptor mutation and pathname replacement before publication. */
async function assertSourceIdentity(source: FileHandle, path: string, expected: LegacyIdentity): Promise<void> {
  const descriptor = await source.stat();
  let pathname;
  try {
    pathname = lstatSync(path);
  } catch {
    throw replacedSource();
  }
  if (
    !pathname.isFile() ||
    pathname.isSymbolicLink() ||
    pathname.nlink !== 1 ||
    descriptor.nlink !== 1 ||
    descriptor.dev !== expected.dev ||
    descriptor.ino !== expected.ino ||
    descriptor.size !== expected.size ||
    descriptor.mtimeMs !== expected.mtimeMs ||
    descriptor.ctimeMs !== expected.ctimeMs ||
    pathname.dev !== expected.dev ||
    pathname.ino !== expected.ino ||
    pathname.size !== expected.size ||
    pathname.mtimeMs !== expected.mtimeMs ||
    pathname.ctimeMs !== expected.ctimeMs
  )
    throw replacedSource();
}

function replacedSource(): SearchableError {
  return new SearchableError('service', 'LEGACY_SOURCE_REPLACED', 'The legacy database changed while it was read.');
}

/** Runs SQLite integrity and row iteration in a terminable worker. */
async function readLegacyRows(
  path: string,
  config: SearchableStore['config'],
  signal: AbortSignal | undefined,
  deadline: SearchableDeadline,
): Promise<readonly SearchableImportCandidate[]> {
  checkControl(signal, deadline);
  const localWorker = new URL('./migration-worker.js', import.meta.url);
  const workerUrl = existsSync(fileURLToPath(localWorker))
    ? localWorker
    : new URL('../dist/migration-worker.js', import.meta.url);
  const worker = new Worker(workerUrl, {
    workerData: {
      path,
      limits: {
        maxUrlBytes: config.security.limits.max_url_bytes,
        maxTitleBytes: config.security.limits.max_title_bytes,
        maxContentBytes: config.security.limits.max_content_bytes,
        maxStorageBytes: config.security.limits.max_storage_bytes,
      },
    },
  });
  return runBoundedWorker(worker, {
    ...(signal === undefined ? {} : { signal }),
    timeoutMs: remainingSearchableDeadline(deadline),
    cancellationError: () =>
      new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable migration was cancelled.'),
    timeoutError: deadlineError,
    workerError: () => new SearchableError('service', 'LEGACY_DATABASE_INVALID', 'The legacy database worker failed.'),
    decode(value) {
      const message = value as MigrationWorkerMessage;
      if (message.ok && Array.isArray(message.rows)) return message.rows as readonly SearchableImportCandidate[];
      throw new SearchableError(
        message.code === 'LEGACY_DATABASE_TOO_LARGE' ? 'resource_limit' : 'service',
        message.code ?? 'LEGACY_DATABASE_INVALID',
        message.message ?? 'The legacy database could not be read.',
      );
    },
  });
}

function projectPath(cwd: string, value: string): string {
  if (!value || isAbsolute(value))
    throw new SearchableError('validation', 'LEGACY_PATH_INVALID', 'The legacy path must be project-relative.');
  const root = resolve(cwd);
  const path = resolve(root, value);
  const nested = relative(root, path);
  if (!nested || nested === '..' || nested.startsWith('../') || dirname(nested) !== '.')
    throw new SearchableError(
      'validation',
      'LEGACY_PATH_INVALID',
      'The legacy database must be a direct child of the project root.',
    );
  return path;
}

function rejectSidecars(path: string): void {
  for (const suffix of ['-wal', '-shm'])
    try {
      lstatSync(`${path}${suffix}`);
      throw new SearchableError(
        'service',
        'LEGACY_DATABASE_BUSY',
        'Stop the legacy server and remove live WAL/SHM state before import.',
      );
    } catch (error: unknown) {
      if (error instanceof SearchableError) throw error;
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
}

function duplicateUrls(rows: readonly SearchableImportCandidate[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.url)) duplicates.add(pageId(row.url));
    seen.add(row.url);
  }
  return [...duplicates].slice(0, 100);
}

function report(
  preview: boolean,
  valid: boolean,
  planned: number,
  imported: number,
  conflicts: readonly string[],
  warnings: readonly string[],
  errors: readonly string[],
): LegacyImportReport {
  return { preview, valid, planned, imported, conflicts, warnings, errors };
}

function checkControl(signal: AbortSignal | undefined, deadline: SearchableDeadline): void {
  try {
    checkSearchableDeadline(deadline, signal);
  } catch (error: unknown) {
    if (signal?.aborted)
      throw new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable migration was cancelled.');
    throw error;
  }
}

function deadlineError(): SearchableError {
  return new SearchableError('service', 'DEADLINE_EXCEEDED', 'Searchable migration exceeded its deadline.');
}
