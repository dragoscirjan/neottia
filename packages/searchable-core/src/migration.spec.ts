import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { importLegacySearchableDatabase } from './migration.js';
import { createSearchableRuntime } from './runtime.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it('previews and explicitly imports an immutable legacy database', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-migration-'));
  roots.push(cwd);
  const path = join(cwd, '.web_stash.db');
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE pages (url TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL)');
  database
    .prepare('INSERT INTO pages(url,title,content) VALUES(?,?,?)')
    .run('https://example.com/legacy', 'Legacy page', 'migration marker content');
  database.close();
  const source = readFileSync(path);
  const runtime = createSearchableRuntime({ cwd, configOverrides: { enabled: true } });
  try {
    const preview = await importLegacySearchableDatabase(runtime.store, { path: '.web_stash.db' });
    expect(preview).toMatchObject({ preview: true, valid: true, planned: 1, imported: 0 });
    expect(readFileSync(path)).toEqual(source);

    const applied = await importLegacySearchableDatabase(runtime.store, {
      path: '.web_stash.db',
      preview: false,
    });
    expect(applied).toMatchObject({ preview: false, valid: true, planned: 1, imported: 1 });
    expect(readFileSync(path)).toEqual(source);
    const rerun = await importLegacySearchableDatabase(runtime.store, {
      path: '.web_stash.db',
      preview: false,
    });
    expect(rerun).toMatchObject({ valid: true, planned: 0, imported: 0 });
    expect(rerun.warnings[0]).toContain('already match');
    expect(await runtime.store.grep({ query: 'marker', limit: 5 })).toMatchObject({
      results: [{ url: 'https://example.com/legacy', title: 'Legacy page' }],
    });
  } finally {
    await runtime.close();
  }
});

it('does not report failure after canonical publication if the legacy source changes', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-migration-'));
  roots.push(cwd);
  const path = join(cwd, '.web_stash.db');
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE pages (url TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL)');
  database
    .prepare('INSERT INTO pages(url,title,content) VALUES(?,?,?)')
    .run('https://example.com/published', 'Published', 'published migration marker');
  database.close();
  const runtime = createSearchableRuntime({ cwd, configOverrides: { enabled: true } });
  const importPages = runtime.store.importPages.bind(runtime.store);
  vi.spyOn(runtime.store, 'importPages').mockImplementation(async (candidates, preview, context) => {
    const result = await importPages(candidates, preview, context);
    appendFileSync(path, Buffer.from([0]));
    return result;
  });
  try {
    const result = await importLegacySearchableDatabase(runtime.store, {
      path: '.web_stash.db',
      preview: false,
    });
    expect(result).toMatchObject({ preview: false, valid: true, planned: 1, imported: 1 });
  } finally {
    await runtime.close();
  }
});

it('rejects a symlinked legacy source without following it', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-migration-'));
  roots.push(cwd);
  const outside = join(cwd, 'outside.sqlite');
  const database = new DatabaseSync(outside);
  database.exec('CREATE TABLE pages (url TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL)');
  database.close();
  symlinkSync(outside, join(cwd, '.web_stash.db'));
  const runtime = createSearchableRuntime({ cwd, configOverrides: { enabled: true } });
  try {
    const report = await importLegacySearchableDatabase(runtime.store, { path: '.web_stash.db' });
    expect(report).toMatchObject({ valid: false, planned: 0, imported: 0 });
    expect(report.errors[0]).toContain('regular singly-linked file');
  } finally {
    await runtime.close();
  }
});

it('rejects a legacy path below a symlinked ancestor', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-migration-'));
  const outside = mkdtempSync(join(tmpdir(), 'searchable-migration-outside-'));
  roots.push(cwd, outside);
  const database = new DatabaseSync(join(outside, '.web_stash.db'));
  database.exec('CREATE TABLE pages (url TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL)');
  database.close();
  symlinkSync(outside, join(cwd, 'linked'));
  const runtime = createSearchableRuntime({ cwd, configOverrides: { enabled: true } });
  try {
    const report = await importLegacySearchableDatabase(runtime.store, { path: 'linked/.web_stash.db' });
    expect(report).toMatchObject({ valid: false, planned: 0, imported: 0 });
    expect(report.errors[0]).toContain('direct child');
  } finally {
    await runtime.close();
  }
});

it('honors cancellation before snapshot and worker validation', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-migration-'));
  roots.push(cwd);
  const path = join(cwd, '.web_stash.db');
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE pages (url TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL)');
  database.close();
  const controller = new AbortController();
  controller.abort();
  const runtime = createSearchableRuntime({ cwd, configOverrides: { enabled: true } });
  try {
    const report = await importLegacySearchableDatabase(runtime.store, {
      path: '.web_stash.db',
      signal: controller.signal,
    });
    expect(report).toMatchObject({ valid: false, planned: 0, imported: 0 });
    expect(report.errors[0]).toContain('cancelled');
  } finally {
    await runtime.close();
  }
});

it('does not extend a converted migration deadline when the wall clock moves backward', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-migration-'));
  roots.push(cwd);
  const path = join(cwd, '.web_stash.db');
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE pages (url TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL)');
  database.close();
  const runtime = createSearchableRuntime({ cwd, configOverrides: { enabled: true } });
  const epoch = Date.now();
  const clock = vi
    .spyOn(Date, 'now')
    .mockReturnValueOnce(epoch)
    .mockReturnValue(epoch - 3_600_000);
  try {
    const report = await importLegacySearchableDatabase(runtime.store, {
      path: '.web_stash.db',
      deadline: epoch + 1,
    });
    expect(report).toMatchObject({ valid: false, planned: 0, imported: 0 });
    expect(report.errors[0]).toContain('deadline');
  } finally {
    clock.mockRestore();
    await runtime.close();
  }
});

it('rejects a legacy file above max_storage_bytes before worker validation', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-migration-'));
  roots.push(cwd);
  const path = join(cwd, '.web_stash.db');
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE pages (url TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL)');
  database
    .prepare('INSERT INTO pages(url,title,content) VALUES(?,?,?)')
    .run('https://example.com/large', 'Large', 'x'.repeat(16_000));
  database.close();
  const runtime = createSearchableRuntime({
    cwd,
    configOverrides: { enabled: true, security: { limits: { max_storage_bytes: 8_192 } } },
  });
  try {
    const report = await importLegacySearchableDatabase(runtime.store, { path: '.web_stash.db' });
    expect(report).toMatchObject({ valid: false, planned: 0, imported: 0 });
    expect(report.errors[0]).toContain('max_storage_bytes');
  } finally {
    await runtime.close();
  }
});

it('rejects live sidecars before reading legacy rows', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'searchable-migration-'));
  roots.push(cwd);
  const path = join(cwd, '.web_stash.db');
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE pages (url TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT)');
  database.close();
  mkdirSync(`${path}-wal`);
  const runtime = createSearchableRuntime({ cwd, configOverrides: { enabled: true } });
  try {
    const report = await importLegacySearchableDatabase(runtime.store, { path: '.web_stash.db' });
    expect(report).toMatchObject({ valid: false, planned: 0, imported: 0 });
    expect(report.errors[0]).toContain('Stop the legacy server');
  } finally {
    await runtime.close();
  }
});
