import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { loadSearchableConfig, type SearchableConfigInput } from './config.js';
import { SEARCHABLE_CACHE_FIXED_BYTES, SEARCHABLE_CACHE_STORAGE_MULTIPLIER, SearchableStore } from './stash.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function store(overrides: Partial<SearchableConfigInput> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-stash-'));
  roots.push(cwd);
  return new SearchableStore(loadSearchableConfig(cwd, { enabled: true, ...overrides }), cwd);
}

it('rebuilds a corrupt disposable cache from canonical pages', async () => {
  const stash = store();
  await stash.stash({ url: 'https://example.com/cache', title: 'Cache', content: 'canonical rebuild marker' });
  expect(await stash.grep({ query: 'marker', limit: 5 })).toMatchObject({ results: [{ title: 'Cache' }] });
  writeFileSync(join(stash.cwd, '.neottia', 'cache', 'searchable.sqlite'), 'not a database');
  expect(await stash.grep({ query: 'marker', limit: 5 })).toMatchObject({ results: [{ title: 'Cache' }] });
});

it('invalidates cache candidates when canonical content changes', async () => {
  const stash = store();
  await stash.stash({ url: 'https://example.com/page', title: 'Old title', content: 'old marker content' });
  await stash.grep({ query: 'old', limit: 5 });
  const pages = join(stash.cwd, '.neottia', 'searchable', 'pages');
  const path = join(pages, readdirSync(pages)[0] as string);
  const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  writeFileSync(
    path,
    `${JSON.stringify({ ...record, title: 'New title', content: 'new canonical words' }, null, 2)}\n`,
  );
  expect(await stash.grep({ query: 'new', limit: 5 })).toMatchObject({ results: [{ title: 'New title' }] });
  expect(await stash.grep({ query: 'old', limit: 5 })).toEqual({ results: [] });
});

it('reloads only matching canonical records after the FTS query', async () => {
  const stash = store();
  await stash.stash({ url: 'https://example.com/candidate', title: 'Candidate', content: 'selective marker' });
  const pages = join(stash.cwd, '.neottia', 'searchable', 'pages');
  const unrelated = join(pages, `page-${'f'.repeat(64)}.json`);
  const context = {
    cwd: stash.cwd,
    config: stash.config,
    onStaleCache: async () => {
      // Simulate an unrelated canonical write after the operation's initial catalog scan.
      writeFileSync(unrelated, 'not json');
      return true;
    },
  };

  await expect(stash.grep({ query: 'selective', limit: 5 }, context)).resolves.toMatchObject({
    results: [{ title: 'Candidate' }],
  });
});

it('health-checks legal multi-page stashes without one aggregate result allocation', async () => {
  const stash = store({
    security: {
      limits: {
        max_content_bytes: 600_000,
        max_result_bytes: 1_024,
        max_storage_bytes: 2_000_000,
      },
    },
    cache: { stale_policy: 'rebuild' },
  });
  await stash.stash({ url: 'https://example.com/large-a', title: 'Large A', content: `alpha ${'a'.repeat(550_000)}` });
  await stash.stash({ url: 'https://example.com/large-b', title: 'Large B', content: `beta ${'b'.repeat(550_000)}` });
  expect(await stash.grep({ query: 'alpha', limit: 5 })).toMatchObject({ results: [{ title: 'Large A' }] });
  expect(await stash.grep({ query: 'beta', limit: 5 })).toMatchObject({ results: [{ title: 'Large B' }] });
});

it('rebuilds token-rich canonical content near quota with a separate bounded cache allowance', async () => {
  const maxStorageBytes = 190_000;
  const stash = store({
    security: {
      limits: {
        max_content_bytes: 180_000,
        max_storage_bytes: maxStorageBytes,
      },
    },
    cache: { stale_policy: 'rebuild' },
  });
  await stash.stash({
    url: 'https://example.com/token-rich',
    title: 'Token rich',
    content: `needle ${'word '.repeat(34_000)}`,
  });
  await expect(stash.grep({ query: 'needle', limit: 5 })).resolves.toMatchObject({
    results: [{ title: 'Token rich' }],
  });
  const cacheDirectory = join(stash.cwd, '.neottia', 'cache');
  const cacheBytes = readdirSync(cacheDirectory)
    .filter((name) => name.startsWith('searchable.sqlite'))
    .reduce((total, name) => total + statSync(join(cacheDirectory, name)).size, 0);
  expect(cacheBytes).toBeGreaterThan(maxStorageBytes);
  expect(cacheBytes).toBeLessThanOrEqual(
    maxStorageBytes * SEARCHABLE_CACHE_STORAGE_MULTIPLIER + SEARCHABLE_CACHE_FIXED_BYTES,
  );
});

it('prompts for rebuild only when cache work is required', async () => {
  const stash = store();
  await stash.stash({ url: 'https://example.com/prompt', title: 'Prompt', content: 'prompt marker' });
  const onStaleCache = vi.fn(async () => true);
  const context = { cwd: stash.cwd, config: stash.config, onStaleCache };
  await stash.grep({ query: 'marker', limit: 5 }, context);
  expect(onStaleCache).toHaveBeenCalledOnce();
  await stash.grep({ query: 'marker', limit: 5 }, context);
  expect(onStaleCache).toHaveBeenCalledOnce();
});

it('serializes concurrent cache decisions and prompts only once', async () => {
  const stash = store();
  await stash.stash({ url: 'https://example.com/concurrent', title: 'Concurrent', content: 'serialized marker' });
  const onStaleCache = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return true;
  });
  const context = { cwd: stash.cwd, config: stash.config, onStaleCache };
  const [first, second] = await Promise.all([
    stash.grep({ query: 'marker', limit: 5 }, context),
    stash.grep({ query: 'marker', limit: 5 }, context),
  ]);
  expect(first.results).toHaveLength(1);
  expect(second.results).toHaveLength(1);
  expect(onStaleCache).toHaveBeenCalledOnce();
});

it('closes a stale cache before a confirmation callback fails', async () => {
  const stash = store({ cache: { max_age_ms: 0, stale_policy: 'prompt' } });
  await stash.stash({ url: 'https://example.com/prompt-error', title: 'Prompt', content: 'callback marker' });
  await stash.grep(
    { query: 'marker', limit: 5 },
    { cwd: stash.cwd, config: stash.config, onStaleCache: async () => true },
  );
  await expect(
    stash.grep(
      { query: 'marker', limit: 5 },
      { cwd: stash.cwd, config: stash.config, onStaleCache: async () => Promise.reject(new Error('UI failed')) },
    ),
  ).rejects.toMatchObject({ code: 'STASH_STORAGE_FAILED' });
  await expect(
    stash.grep({ query: 'marker', limit: 5 }, { cwd: stash.cwd, config: stash.config, onStaleCache: async () => true }),
  ).resolves.toMatchObject({ results: [{ title: 'Prompt' }] });
});

it('honors a store operation deadline before canonical work', async () => {
  const stash = store();
  await expect(
    stash.validate({ cwd: stash.cwd, config: stash.config, deadline: Date.now() - 1 }),
  ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
});

it('does not extend a converted store deadline when the wall clock moves backward', async () => {
  const stash = store();
  await stash.stash({ url: 'https://example.com/clock', title: 'Clock', content: 'monotonic deadline marker' });
  const epoch = Date.now();
  const clock = vi
    .spyOn(Date, 'now')
    .mockReturnValueOnce(epoch)
    .mockReturnValue(epoch - 3_600_000);
  try {
    await expect(
      stash.grep(
        { query: 'marker', limit: 5 },
        {
          cwd: stash.cwd,
          config: stash.config,
          deadline: epoch + 10,
          onStaleCache: async () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 30)),
        },
      ),
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
  } finally {
    clock.mockRestore();
  }
});

it('fails closed on symlinked canonical records', async () => {
  const stash = store();
  const pages = join(stash.cwd, '.neottia', 'searchable', 'pages');
  mkdirSync(pages, { recursive: true });
  const outside = join(stash.cwd, 'outside.json');
  writeFileSync(outside, '{}');
  symlinkSync(outside, join(pages, 'page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'));
  await expect(stash.validate()).rejects.toMatchObject({ code: 'STASH_STORAGE_FAILED' });
});

it('enforces aggregate canonical storage quotas before publication', async () => {
  const stash = store({ security: { limits: { max_storage_bytes: 100 } } });
  await expect(
    stash.stash({ url: 'https://example.com/quota', title: 'Quota', content: 'content exceeds tiny aggregate quota' }),
  ).rejects.toMatchObject({ code: 'STASH_STORAGE_LIMIT' });
  expect(existsSync(join(stash.cwd, '.neottia', 'searchable', 'pages'))).toBe(false);
});
