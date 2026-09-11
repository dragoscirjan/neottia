import { afterEach, describe, expect, it, vi } from 'vitest';

const repositoryStore = vi.hoisted(() => ({
  openDisposableSqliteCache: vi.fn(),
  resolveManagedPath: vi.fn(() => ({})),
}));

vi.mock('@neottia/repository-store', () => ({
  openDisposableSqliteCache: repositoryStore.openDisposableSqliteCache,
  resolveManagedPath: repositoryStore.resolveManagedPath,
}));

import { openMemoryCache } from './index-sqlite.js';

const root = {} as Parameters<typeof openMemoryCache>[0];
const lease = {} as Parameters<typeof openMemoryCache>[1];
const state = {
  records: [],
  tombstones: [],
  activeIds: new Set<string>(),
  contentHash: 'digest',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('Memory SQLite cache lifecycle', () => {
  it('closes an opened cache when freshness validation rejects', async () => {
    const failure = new Error('freshness query failed');
    const close = vi.fn().mockResolvedValue(undefined);
    repositoryStore.openDisposableSqliteCache.mockResolvedValue({
      state: 'ready',
      database: {
        prepare: vi.fn().mockRejectedValue(failure),
      },
      close,
    });

    await expect(openMemoryCache(root, lease, state, 1_000)).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes an opened cache whose freshness metadata is stale', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    repositoryStore.openDisposableSqliteCache.mockResolvedValue({
      state: 'ready',
      database: {
        prepare: vi.fn().mockResolvedValue({
          get: vi.fn().mockResolvedValue({ value: new Date(0).toISOString() }),
        }),
      },
      close,
    });

    await expect(openMemoryCache(root, lease, state, 1_000)).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});
