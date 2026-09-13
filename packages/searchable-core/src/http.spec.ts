import { createServer, type Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { assertPublicAddress, assertSafeWebUrl, SafeHttpClient, type SearchableDnsResolver } from './http.js';

const blockedUrls = [
  'http://localhost/',
  'http://sub.localhost/',
  'http://127.0.0.1/',
  'http://2130706433/',
  'http://0x7f000001/',
  'http://0177.0.0.1/',
  'http://10.0.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://192.168.1.1/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[fc00::1]/',
  'http://[fe80::1]/',
  'http://user:secret@example.com/',
];

describe('public network policy', () => {
  it.each(blockedUrls)('rejects %s before DNS', (value) => {
    expect(() => assertSafeWebUrl(new URL(value))).toThrowError(
      expect.objectContaining({ code: 'NETWORK_DESTINATION_BLOCKED' }),
    );
  });

  it('rejects mixed public/private answers without opening a request', async () => {
    const resolver = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '127.0.0.1', family: 4 as const },
    ]);
    const client = new SafeHttpClient(resolver);
    await expect(
      client.request({ url: new URL('https://example.com'), deadline: Date.now() + 1_000, maximumBytes: 1_024 }),
    ).rejects.toMatchObject({ code: 'NETWORK_DESTINATION_BLOCKED' });
    expect(resolver).toHaveBeenCalledOnce();
  });

  it('rejects inconsistent DNS address families', async () => {
    const resolver: SearchableDnsResolver = async () => [{ address: '93.184.216.34', family: 6 }];
    const client = new SafeHttpClient(resolver);
    await expect(
      client.request({ url: new URL('https://example.com'), deadline: Date.now() + 1_000, maximumBytes: 1_024 }),
    ).rejects.toMatchObject({ code: 'NETWORK_DESTINATION_BLOCKED' });
  });

  it('bounds slow DNS by the request deadline', async () => {
    const resolver: SearchableDnsResolver = () => new Promise(() => undefined);
    const client = new SafeHttpClient(resolver);
    await expect(
      client.request({ url: new URL('https://example.com'), deadline: Date.now() + 10, maximumBytes: 1_024 }),
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
  });

  it('distinguishes caller cancellation during DNS', async () => {
    const controller = new AbortController();
    const resolver: SearchableDnsResolver = () => new Promise(() => undefined);
    const client = new SafeHttpClient(resolver);
    const pending = client.request({
      url: new URL('https://example.com'),
      signal: controller.signal,
      deadline: Date.now() + 1_000,
      maximumBytes: 1_024,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
  });

  it.each(['2001:20::1', '3fff::1', '5f00::1'])('rejects the special-use IPv6 address %s', (address) => {
    expect(() => assertPublicAddress(address)).toThrowError(
      expect.objectContaining({ code: 'NETWORK_DESTINATION_BLOCKED' }),
    );
  });

  it.each(['headers', 'body'])('enforces an absolute deadline while response %s stall', async (phase) => {
    const server = createServer((_request, response) => {
      if (phase === 'body') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.write('first chunk');
      }
    });
    const url = await listen(server);
    const client = new SafeHttpClient();
    const started = performance.now();
    try {
      await expect(
        client.request({
          url,
          deadline: Date.now() + 30,
          maximumBytes: 1_024,
          destination: 'trusted-local',
        }),
      ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
      expect(performance.now() - started).toBeLessThan(500);
    } finally {
      server.closeAllConnections();
      await close(server);
    }
  });

  it.each(['deadline', 'cancellation'] as const)('stops a decoded response stream on %s', async (mode) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.write('{"response":"first","done":false}\n');
    });
    const url = await listen(server);
    const client = new SafeHttpClient();
    const controller = new AbortController();
    try {
      const streamed = await client.stream({
        url,
        signal: controller.signal,
        deadline: Date.now() + (mode === 'deadline' ? 30 : 1_000),
        maximumBytes: 1_024,
        destination: 'trusted-local',
      });
      const consumed = (async () => {
        for await (const chunk of streamed.chunks) {
          void chunk;
          if (mode === 'cancellation') controller.abort();
        }
      })();
      await expect(consumed).rejects.toMatchObject({
        code: mode === 'deadline' ? 'DEADLINE_EXCEEDED' : 'OPERATION_CANCELLED',
      });
    } finally {
      server.closeAllConnections();
      await close(server);
    }
  });

  it('accepts ordinary public addresses', () => {
    expect(() => assertPublicAddress('93.184.216.34')).not.toThrow();
    expect(() => assertPublicAddress('2606:2800:220:1:248:1893:25c8:1946')).not.toThrow();
  });
});

async function listen(server: Server): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test HTTP server did not bind a TCP port.');
  return new URL(`http://127.0.0.1:${address.port}`);
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
