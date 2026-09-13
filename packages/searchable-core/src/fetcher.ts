import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { SearchableError } from './errors.js';
import {
  assertSafeWebUrl,
  checkSearchableDeadline,
  createSearchableDeadline,
  remainingSearchableDeadline,
  shortenSearchableDeadline,
  type SearchableDeadline,
  type SearchableHttpResponse,
  type SearchableHttpTransport,
} from './http.js';
import type { SearchableOperationContext } from './services.js';
import type { SearchableToolOutput } from './tool-contracts.js';
import { runBoundedWorker } from './worker.js';

/** Fetches and extracts one page through the configured bounded strategy order. */
export async function fetchPage(
  transport: SearchableHttpTransport,
  requested: URL,
  context: SearchableOperationContext,
): Promise<SearchableToolOutput<'web_fetch'>> {
  assertSafeWebUrl(requested);
  const deadline =
    context.transportDeadline ?? createSearchableDeadline(context.config.fetch.overall_timeout_ms, context.deadline);
  const failures: string[] = [];
  for (const strategy of context.config.fetch.strategies) {
    checkOperation(context.signal, deadline);
    try {
      if (strategy === 'direct') return await directFetch(transport, requested, context, deadline, 'direct');
      if (requested.search || requested.username || requested.password) {
        failures.push(`${strategy}: FALLBACK_DISCLOSURE_BLOCKED`);
        continue;
      }
      if (strategy === 'jina') return await jinaFetch(transport, requested, context, deadline);
      return await waybackFetch(transport, requested, context, deadline);
    } catch (error: unknown) {
      if (context.signal?.aborted) throw cancellationError();
      if (error instanceof SearchableError && error.code === 'DEADLINE_EXCEEDED') throw error;
      failures.push(`${strategy}: ${error instanceof SearchableError ? error.code : 'FETCH_FAILED'}`);
    }
  }
  throw new SearchableError('service', 'FETCH_FAILED', 'Every configured fetch strategy failed.', [], {
    strategies: failures,
  });
}

async function directFetch(
  transport: SearchableHttpTransport,
  requested: URL,
  context: SearchableOperationContext,
  deadline: SearchableDeadline,
  source: 'direct' | 'wayback',
): Promise<SearchableToolOutput<'web_fetch'>> {
  const response = await transport.request({
    url: requested,
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 (compatible; NeottiaSearchable/1.0)',
    },
    signal: context.signal,
    deadline: attemptDeadline(deadline, context.config.fetch.timeout_ms),
    maximumBytes: context.config.fetch.max_response_bytes,
    redirectPolicy: 'safe-web',
  });
  assertFetchStatus(response);
  const contentType = response.headers['content-type']?.toLowerCase() ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml'))
    throw new SearchableError('service', 'FETCH_CONTENT_TYPE_UNSUPPORTED', 'Direct extraction requires HTML or XHTML.');
  return extractHtml(response, requested, context, deadline, source);
}

async function jinaFetch(
  transport: SearchableHttpTransport,
  requested: URL,
  context: SearchableOperationContext,
  deadline: SearchableDeadline,
): Promise<SearchableToolOutput<'web_fetch'>> {
  const endpoint = new URL(`https://r.jina.ai/${requested.href}`);
  const response = await transport.request({
    url: endpoint,
    headers: { accept: 'text/plain', 'user-agent': 'Neottia Searchable/1' },
    signal: context.signal,
    deadline: attemptDeadline(deadline, context.config.fetch.timeout_ms),
    maximumBytes: context.config.fetch.max_response_bytes,
    redirectPolicy: 'none',
  });
  assertFetchStatus(response);
  const markdown = Buffer.from(response.bytes).toString('utf8').trim();
  assertExtracted(markdown, context);
  const titleMatch = /^Title:\s*(.+)$/imu.exec(markdown);
  return {
    title: titleMatch?.[1]?.trim() || requested.hostname,
    content: markdown,
    url: requested.href,
    source: 'jina',
  };
}

async function waybackFetch(
  transport: SearchableHttpTransport,
  requested: URL,
  context: SearchableOperationContext,
  deadline: SearchableDeadline,
): Promise<SearchableToolOutput<'web_fetch'>> {
  const availability = new URL('https://archive.org/wayback/available');
  availability.searchParams.set('url', requested.href);
  const response = await transport.request({
    url: availability,
    signal: context.signal,
    deadline: attemptDeadline(deadline, context.config.fetch.timeout_ms),
    maximumBytes: Math.min(256 * 1024, context.config.fetch.max_response_bytes),
    redirectPolicy: 'none',
  });
  assertFetchStatus(response);
  let snapshot: unknown;
  try {
    const parsed = JSON.parse(Buffer.from(response.bytes).toString('utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error('invalid root');
    const archived = isRecord(parsed['archived_snapshots']) ? parsed['archived_snapshots'] : {};
    const closest = isRecord(archived['closest']) ? archived['closest'] : {};
    snapshot = closest['url'];
  } catch {
    throw new SearchableError('service', 'WAYBACK_RESPONSE_INVALID', 'The Wayback availability response is invalid.');
  }
  if (typeof snapshot !== 'string')
    throw new SearchableError('service', 'WAYBACK_NOT_FOUND', 'Wayback has no snapshot for this URL.');
  let snapshotUrl: URL;
  try {
    snapshotUrl = new URL(snapshot);
  } catch {
    throw new SearchableError('service', 'WAYBACK_RESPONSE_INVALID', 'Wayback returned an invalid snapshot URL.');
  }
  if (
    snapshotUrl.protocol !== 'https:' ||
    snapshotUrl.hostname !== 'web.archive.org' ||
    snapshotUrl.username ||
    snapshotUrl.password
  )
    throw new SearchableError('service', 'WAYBACK_RESPONSE_INVALID', 'Wayback returned an untrusted snapshot URL.');
  return directFetch(transport, snapshotUrl, context, deadline, 'wayback').then((value) => ({
    ...value,
    url: requested.href,
    source: 'wayback',
  }));
}

async function extractHtml(
  response: SearchableHttpResponse,
  requested: URL,
  context: SearchableOperationContext,
  overallDeadline: SearchableDeadline,
  source: 'direct' | 'wayback',
): Promise<SearchableToolOutput<'web_fetch'>> {
  const deadline = attemptDeadline(overallDeadline, context.config.fetch.timeout_ms);
  checkOperation(context.signal, deadline);
  const localWorker = new URL('./extraction-worker.js', import.meta.url);
  // Vitest executes source modules, while the production package executes dist modules.
  const workerUrl = existsSync(fileURLToPath(localWorker))
    ? localWorker
    : new URL('../dist/extraction-worker.js', import.meta.url);
  const worker = new Worker(workerUrl, {
    workerData: {
      html: Buffer.from(response.bytes).toString('utf8'),
      finalUrl: response.finalUrl.href,
      requestedUrl: requested.href,
      source,
      maximumContentBytes: context.config.security.limits.max_content_bytes,
    },
  });
  return runBoundedWorker(worker, {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    timeoutMs: remainingSearchableDeadline(deadline),
    cancellationError: () =>
      new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable operation was cancelled.'),
    timeoutError: () => new SearchableError('service', 'DEADLINE_EXCEEDED', 'Page extraction exceeded its deadline.'),
    workerError: () => new SearchableError('service', 'EXTRACTION_FAILED', 'Page extraction worker failed.'),
    decode(message) {
      if (!isRecord(message))
        throw new SearchableError('service', 'EXTRACTION_FAILED', 'Page extraction returned an invalid result.');
      if (message['error'] === 'EXTRACTED_CONTENT_TOO_LARGE')
        throw new SearchableError(
          'resource_limit',
          'EXTRACTED_CONTENT_TOO_LARGE',
          'Extracted content exceeds the configured byte limit.',
        );
      if (!isRecord(message['result']))
        throw new SearchableError('service', 'EXTRACTION_FAILED', 'Readability could not extract page content.');
      return message['result'] as SearchableToolOutput<'web_fetch'>;
    },
  });
}

function assertExtracted(content: string, context: SearchableOperationContext): void {
  if (!content.trim())
    throw new SearchableError('service', 'EXTRACTION_FAILED', 'Page extraction returned no content.');
  if (Buffer.byteLength(content, 'utf8') > context.config.security.limits.max_content_bytes)
    throw new SearchableError(
      'resource_limit',
      'EXTRACTED_CONTENT_TOO_LARGE',
      'Extracted content exceeds the configured byte limit.',
    );
}

function assertFetchStatus(response: SearchableHttpResponse): void {
  if (response.status < 200 || response.status >= 300)
    throw new SearchableError(
      'service',
      'FETCH_UPSTREAM_FAILED',
      `The fetch endpoint returned HTTP ${response.status}.`,
    );
}

function attemptDeadline(overall: SearchableDeadline, timeoutMs: number): SearchableDeadline {
  return shortenSearchableDeadline(overall, timeoutMs);
}

function checkOperation(signal: AbortSignal | undefined, deadline: SearchableDeadline): void {
  checkSearchableDeadline(deadline, signal);
}

function cancellationError(): SearchableError {
  return new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable operation was cancelled.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
