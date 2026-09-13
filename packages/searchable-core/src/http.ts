import { lookup as systemLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { SearchableError } from './errors.js';

/** A DNS answer accepted by the network policy. */
export interface SearchableDnsAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Injectable DNS seam used by deterministic provider and SSRF tests. */
export type SearchableDnsResolver = (
  hostname: string,
  signal?: AbortSignal,
) => Promise<readonly SearchableDnsAddress[]>;

/** Monotonic operation deadline shared across attempts and redirects. */
export interface SearchableDeadline {
  readonly expiresAt: number;
}

/** Creates a monotonic deadline bounded by an optional public epoch deadline. */
export function createSearchableDeadline(timeoutMs: number, epochDeadline?: number): SearchableDeadline {
  const parentRemaining = epochDeadline === undefined ? timeoutMs : Math.max(0, epochDeadline - Date.now());
  return { expiresAt: performance.now() + Math.min(timeoutMs, parentRemaining) };
}

/** Narrows one attempt without extending its parent operation. */
export function shortenSearchableDeadline(deadline: SearchableDeadline, timeoutMs: number): SearchableDeadline {
  return { expiresAt: Math.min(deadline.expiresAt, performance.now() + timeoutMs) };
}

/** One bounded HTTP request issued by a Searchable runtime. */
export interface SearchableHttpRequest {
  readonly url: URL;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
  readonly signal?: AbortSignal;
  readonly deadline: number | SearchableDeadline;
  readonly maximumBytes: number;
  readonly redirectPolicy?: 'none' | 'safe-web';
  /** Only trusted configuration, currently Ollama, may use this exception. */
  readonly destination?: 'public' | 'trusted-local';
}

/** A fully buffered response whose decoded bytes already passed the cap. */
export interface SearchableHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
  readonly finalUrl: URL;
}

/** A decoded response stream that retains its request until consumption ends. */
export interface SearchableHttpStreamResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly chunks: AsyncIterable<Uint8Array>;
  readonly finalUrl: URL;
  /** Stops network and decoder work after a consumer rejects the stream. */
  cancel(reason?: Error): void;
}

/** Injectable transport shared by providers, fetching, fallbacks, and Ollama. */
export interface SearchableHttpTransport {
  request(input: SearchableHttpRequest): Promise<SearchableHttpResponse>;
  /** Required only by streaming consumers such as Ollama generation. */
  stream?(input: SearchableHttpRequest): Promise<SearchableHttpStreamResponse>;
  close?(): Promise<void>;
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fec0::', 10],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(network, prefix, 'ipv6');

/** Rejects local, private, special-use, and ambiguous network destinations. */
export function assertPublicAddress(address: string): void {
  const family = isIP(address);
  const mappedIpv4 = address.toLowerCase().startsWith('::ffff:');
  if (!family || mappedIpv4 || blocked.check(address, family === 4 ? 'ipv4' : 'ipv6'))
    throw new SearchableError('service', 'NETWORK_DESTINATION_BLOCKED', 'The destination is not publicly routable.');
}

/** Validates an attacker-controlled web URL before DNS or network access. */
export function assertSafeWebUrl(url: URL): void {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new SearchableError('service', 'NETWORK_DESTINATION_BLOCKED', 'The web URL is not permitted.');
  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.includes('%'))
    throw new SearchableError('service', 'NETWORK_DESTINATION_BLOCKED', 'The destination is not publicly routable.');
  if (isIP(hostname)) assertPublicAddress(hostname);
}

/** Default network client with DNS validation, address pinning, and bounded decoding. */
export class SafeHttpClient implements SearchableHttpTransport {
  public constructor(private readonly resolveDns: SearchableDnsResolver = defaultDnsResolver) {}

  /** Node requests do not retain a shared agent, so shutdown has no handle to close. */
  public async close(): Promise<void> {}

  public async request(input: SearchableHttpRequest): Promise<SearchableHttpResponse> {
    let url = new URL(input.url);
    const visited = new Set<string>();
    const deadline = normalizeDeadline(input.deadline);
    let headers = { ...(input.headers ?? {}) };
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      checkDeadline(deadline, input.signal);
      if (visited.has(url.href))
        throw new SearchableError('service', 'REDIRECT_BLOCKED', 'The response contains a redirect loop.');
      visited.add(url.href);
      const response = await this.requestOnce({ ...input, url, headers }, deadline);
      if (!isRedirect(response.status)) return response;
      if (input.redirectPolicy !== 'safe-web' || redirects === 5)
        throw new SearchableError('service', 'REDIRECT_BLOCKED', 'The response redirect is not permitted.');
      const location = response.headers['location'];
      if (!location) throw new SearchableError('service', 'REDIRECT_BLOCKED', 'The response redirect has no location.');
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new SearchableError('service', 'REDIRECT_BLOCKED', 'The response redirect location is invalid.');
      }
      assertSafeWebUrl(next);
      if (url.protocol === 'https:' && next.protocol !== 'https:')
        throw new SearchableError('service', 'REDIRECT_BLOCKED', 'HTTPS downgrade redirects are not permitted.');
      if (next.origin !== url.origin) headers = removeSensitiveHeaders(headers);
      url = next;
    }
    throw new SearchableError('service', 'REDIRECT_BLOCKED', 'The response has too many redirects.');
  }

  /** Opens a bounded decoded stream for endpoints that forbid redirects. */
  public async stream(input: SearchableHttpRequest): Promise<SearchableHttpStreamResponse> {
    if (input.redirectPolicy === 'safe-web')
      throw new SearchableError('service', 'REDIRECT_BLOCKED', 'Streaming requests cannot follow redirects.');
    const deadline = normalizeDeadline(input.deadline);
    checkDeadline(deadline, input.signal);
    return this.requestStreamOnce(input, deadline);
  }

  private async requestOptions(input: SearchableHttpRequest, deadline: SearchableDeadline): Promise<RequestOptions> {
    const trusted = input.destination === 'trusted-local';
    if (!trusted) assertSafeWebUrl(input.url);
    const hostname = stripIpv6Brackets(input.url.hostname);
    const answers = trusted ? [] : await resolvePublic(this.resolveDns, hostname, deadline, input.signal);
    checkDeadline(deadline, input.signal);
    const selected = answers[0];
    return {
      protocol: input.url.protocol,
      hostname,
      port: input.url.port || undefined,
      path: `${input.url.pathname}${input.url.search}`,
      method: input.method ?? 'GET',
      headers: { 'accept-encoding': 'gzip, deflate, br', ...(input.headers ?? {}) },
      signal: input.signal,
      ...(selected === undefined
        ? {}
        : {
            lookup: (
              _host: string,
              _options: unknown,
              callback: (error: NodeJS.ErrnoException | null, address: string, family: 4 | 6) => void,
            ) => callback(null, selected.address, selected.family),
          }),
    };
  }

  private async requestOnce(
    input: SearchableHttpRequest,
    deadline: SearchableDeadline,
  ): Promise<SearchableHttpResponse> {
    const options = await this.requestOptions(input, deadline);
    const request = input.url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<SearchableHttpResponse>((resolve, reject) => {
      let settled = false;
      let activeResponse: Readable | undefined;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };
      const req = request(options, async (response) => {
        activeResponse = response;
        try {
          assertBoundedContentLength(response.headers, input.maximumBytes);
          const bytes = await readDecodedBody(response, input.maximumBytes, input.signal, deadline);
          finish(() =>
            resolve({
              status: response.statusCode ?? 0,
              headers: normalizeHeaders(response.headers),
              bytes,
              finalUrl: new URL(input.url),
            }),
          );
        } catch (error: unknown) {
          response.destroy();
          finish(() => reject(normalizeNetworkError(error, input.signal)));
        }
      });
      const timer = setTimeout(() => {
        const error = deadlineError();
        activeResponse?.destroy(error);
        req.destroy(error);
        finish(() => reject(error));
      }, remainingMilliseconds(deadline));
      req.once('error', (error) => finish(() => reject(normalizeNetworkError(error, input.signal))));
      if (input.body) req.write(input.body);
      req.end();
    });
  }

  /** Opens one response at headers and keeps its absolute timer active through EOF. */
  private async requestStreamOnce(
    input: SearchableHttpRequest,
    deadline: SearchableDeadline,
  ): Promise<SearchableHttpStreamResponse> {
    const options = await this.requestOptions(input, deadline);
    const request = input.url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<SearchableHttpStreamResponse>((resolve, reject) => {
      let opened = false;
      let activeResponse: Readable | undefined;
      let decoded: Readable | undefined;
      let closed = false;
      const close = (reason?: Error) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        decoded?.destroy(reason);
        activeResponse?.destroy(reason);
        req.destroy(reason);
      };
      const failOpen = (error: unknown) => {
        if (opened) return;
        opened = true;
        close(error instanceof Error ? error : undefined);
        reject(normalizeNetworkError(error, input.signal));
      };
      const req = request(options, (response) => {
        activeResponse = response;
        try {
          assertBoundedContentLength(response.headers, input.maximumBytes);
          decoded = decodedResponseStream(response);
          const chunks = boundedDecodedChunks(decoded, input.maximumBytes, input.signal, deadline, () => close());
          opened = true;
          resolve({
            status: response.statusCode ?? 0,
            headers: normalizeHeaders(response.headers),
            chunks,
            finalUrl: new URL(input.url),
            cancel: close,
          });
        } catch (error: unknown) {
          failOpen(error);
        }
      });
      const timer = setTimeout(() => {
        const error = deadlineError();
        if (opened) close(error);
        else failOpen(error);
      }, remainingMilliseconds(deadline));
      req.once('error', (error) => {
        if (!opened) failOpen(error);
      });
      if (input.body) req.write(input.body);
      req.end();
    });
  }
}

function assertBoundedContentLength(headers: IncomingHttpHeaders, maximumBytes: number): void {
  const contentLength = Number(headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes)
    throw new SearchableError(
      'resource_limit',
      'RESPONSE_TOO_LARGE',
      'The response exceeds the configured byte limit.',
    );
}

async function defaultDnsResolver(hostname: string): Promise<readonly SearchableDnsAddress[]> {
  const answers = await systemLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => ({ address: answer.address, family: answer.family as 4 | 6 }));
}

async function resolvePublic(
  resolver: SearchableDnsResolver,
  hostname: string,
  deadline: SearchableDeadline,
  signal?: AbortSignal,
): Promise<readonly SearchableDnsAddress[]> {
  if (isIP(hostname)) {
    assertPublicAddress(hostname);
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }
  let answers: readonly SearchableDnsAddress[];
  try {
    answers = await beforeDeadline(resolver(hostname, signal), deadline, signal);
  } catch (error: unknown) {
    if (error instanceof SearchableError) throw error;
    throw new SearchableError('service', 'PROVIDER_UNAVAILABLE', 'The destination could not be resolved.');
  }
  if (!answers.length)
    throw new SearchableError('service', 'PROVIDER_UNAVAILABLE', 'The destination did not resolve to an address.');
  for (const answer of answers) {
    const family = isIP(answer.address);
    if (family !== answer.family)
      throw new SearchableError(
        'service',
        'NETWORK_DESTINATION_BLOCKED',
        'The DNS answer has an invalid address family.',
      );
    assertPublicAddress(answer.address);
  }
  return answers;
}

/** Bounds DNS resolution even when the platform resolver cannot be cancelled. */
function beforeDeadline<T>(promise: Promise<T>, deadline: SearchableDeadline, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      action();
    };
    const cancel = () =>
      finish(() =>
        reject(new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable operation was cancelled.')),
      );
    const timer = setTimeout(() => finish(() => reject(deadlineError())), remainingMilliseconds(deadline));
    signal?.addEventListener('abort', cancel, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

async function readDecodedBody(
  response: Readable,
  maximumBytes: number,
  signal: AbortSignal | undefined,
  deadline: SearchableDeadline,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of boundedDecodedChunks(decodedResponseStream(response), maximumBytes, signal, deadline)) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

/** Applies response decoding before any consumer sees a byte. */
function decodedResponseStream(response: Readable): Readable {
  const headers = 'headers' in response ? (response.headers as IncomingHttpHeaders) : {};
  const encoding = String(headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip') return response.pipe(createGunzip());
  if (encoding === 'deflate') return response.pipe(createInflate());
  if (encoding === 'br') return response.pipe(createBrotliDecompress());
  return response;
}

/** Yields decoded chunks while enforcing one cumulative byte and time bound. */
async function* boundedDecodedChunks(
  stream: Readable,
  maximumBytes: number,
  signal: AbortSignal | undefined,
  deadline: SearchableDeadline,
  complete: () => void = () => {},
): AsyncGenerator<Uint8Array> {
  let size = 0;
  try {
    for await (const chunk of stream) {
      checkDeadline(deadline, signal);
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.byteLength;
      if (size > maximumBytes)
        throw new SearchableError(
          'resource_limit',
          'RESPONSE_TOO_LARGE',
          'The response exceeds the configured byte limit.',
        );
      yield bytes;
    }
    checkDeadline(deadline, signal);
  } catch (error: unknown) {
    stream.destroy(error instanceof Error ? error : undefined);
    throw normalizeNetworkError(error, signal);
  } finally {
    complete();
  }
}

/** Converts a legacy epoch deadline once at the transport boundary. */
function normalizeDeadline(deadline: number | SearchableDeadline): SearchableDeadline {
  return typeof deadline === 'number' ? createSearchableDeadline(Math.max(0, deadline - Date.now())) : deadline;
}

/** Returns the remaining monotonic duration for timers outside the transport. */
export function remainingSearchableDeadline(deadline: SearchableDeadline): number {
  return Math.max(1, deadline.expiresAt - performance.now());
}

function remainingMilliseconds(deadline: SearchableDeadline): number {
  return remainingSearchableDeadline(deadline);
}

/** Rejects cancellation or expiry at a synchronous operation boundary. */
export function checkSearchableDeadline(deadline: SearchableDeadline, signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable operation was cancelled.');
  if (performance.now() >= deadline.expiresAt) throw deadlineError();
}

function checkDeadline(deadline: SearchableDeadline, signal?: AbortSignal): void {
  checkSearchableDeadline(deadline, signal);
}

function deadlineError(): SearchableError {
  return new SearchableError('service', 'DEADLINE_EXCEEDED', 'The Searchable operation exceeded its deadline.');
}

function normalizeNetworkError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted)
    return new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable operation was cancelled.');
  if (error instanceof SearchableError) return error;
  return new SearchableError('service', 'PROVIDER_UNAVAILABLE', 'The network request failed.');
}

function normalizeHeaders(headers: IncomingHttpHeaders): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) =>
      value === undefined ? [] : [[key.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]],
    ),
  );
}

function removeSensitiveHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) =>
        !/^(authorization|cookie|ocp-apim-subscription-key|proxy-authorization|x-api-key|x-subscription-token)$/iu.test(
          name,
        ),
    ),
  );
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}
