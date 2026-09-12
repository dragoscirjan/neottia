import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DESIGN_DOCS_TOOLS, designDocsToolJsonSchema } from '@neottia/design-docs';
import { StaleRevisionError } from '@neottia/repository-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  designDocsToolParameters,
  registerDesignDocsTools,
  type DesignDocsExtensionOptions,
  type PiExtensionApi,
} from './index.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});
function fixture(stalePolicy?: 'prompt'): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-design-docs-'));
  roots.push(root);
  mkdirSync(join(root, '.neottia'));
  writeFileSync(
    join(root, '.neottia/config.yml'),
    `version: 1\nskills:\n  issues:\n    enabled: true\n  design_docs:\n    enabled: true\n${stalePolicy ? `    cache:\n      stale_policy: ${stalePolicy}\n` : ''}`,
  );
  return root;
}

function registeredTools(options: DesignDocsExtensionOptions = {}): {
  registered: Map<string, Parameters<PiExtensionApi['registerTool']>[0]>;
  close: () => Promise<void>;
} {
  const registered = new Map<string, Parameters<PiExtensionApi['registerTool']>[0]>();
  const api: PiExtensionApi = {
    on: () => undefined,
    registerTool: (definition) => registered.set(definition.name, definition),
  };
  return { registered, close: registerDesignDocsTools(api, options) };
}

describe('Pi Design Docs extension', () => {
  it('publishes generated schemas and routes each call to active cwd', async () => {
    const { registered, close } = registeredTools();
    expect(Object.keys(designDocsToolParameters)).toEqual(DESIGN_DOCS_TOOLS.map((tool) => tool.name));
    for (const definition of DESIGN_DOCS_TOOLS)
      expect(JSON.parse(JSON.stringify(designDocsToolParameters[definition.name]))).toMatchObject(
        designDocsToolJsonSchema(definition.name, 'input'),
      );
    const first = fixture();
    const second = fixture();
    const create = registered.get('document_create')!;
    await create.execute('1', { title: 'First', kind: 'hld' }, new AbortController().signal, () => undefined, {
      cwd: first,
    });
    await create.execute('2', { title: 'Second', kind: 'lld' }, new AbortController().signal, () => undefined, {
      cwd: second,
    });
    expect(registered.size).toBe(13);
    const validated = await registered
      .get('document_validate')!
      .execute('validate', { cross_domain: true }, new AbortController().signal, () => undefined, { cwd: first });
    expect(JSON.parse(validated.content[0]?.text ?? '{}')).toMatchObject({ valid: true, findings: [] });
    await expect(
      create.execute('3', { title: 'Invalid', kind: 'adr' }, new AbortController().signal, () => undefined, {
        cwd: first,
      }),
    ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID', retryable: false });
    await close();
  });

  it('preserves retryable repository evidence on the thrown Pi error', async () => {
    const definition = DESIGN_DOCS_TOOLS.find((tool) => tool.name === 'document_id')!;
    vi.spyOn(definition, 'run').mockRejectedValue(
      new StaleRevisionError('stale', { expected: 'sha256:old', actual: 'sha256:new' }),
    );
    const { registered, close } = registeredTools();
    await expect(
      registered
        .get('document_id')!
        .execute('id', {}, new AbortController().signal, () => undefined, { cwd: fixture() }),
    ).rejects.toMatchObject({
      category: 'stale_revision',
      code: 'REVISION_MISMATCH',
      retryable: true,
      details: { expected: 'sha256:old', actual: 'sha256:new' },
    });
    await close();
  });

  it('forwards an explicitly injected link validator', async () => {
    const { registered, close } = registeredTools({
      linkValidator: async () => [
        { category: 'synchronization', code: 'INJECTED', message: 'Injected validator ran.' },
      ],
    });
    const root = fixture();
    const result = await registered
      .get('document_validate')!
      .execute('validate', { cross_domain: true }, new AbortController().signal, () => undefined, { cwd: root });
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      valid: false,
      findings: [{ code: 'INJECTED' }],
    });
    await close();
  });

  it('lets the invocation that encounters stale state control a concurrent prompt', async () => {
    const { registered, close } = registeredTools();
    const root = fixture('prompt');
    const signal = new AbortController().signal;
    const invocation = { cwd: root };
    await registered
      .get('document_create')!
      .execute('create', { title: 'Concurrent', kind: 'hld', body: 'needle' }, signal, () => undefined, invocation);
    await registered
      .get('document_search')!
      .execute('search-1', { query: 'needle' }, signal, () => undefined, invocation);
    const database = new DatabaseSync(join(root, '.neottia/cache/design-docs.sqlite'));
    database
      .prepare("UPDATE neottia_repository_cache_meta SET value=? WHERE key='rebuilt_at'")
      .run('2000-01-01T00:00:00.000Z');
    database.close();
    const confirm = vi.fn(async () => false);
    const [search, list] = await Promise.allSettled([
      registered
        .get('document_search')!
        .execute('search-2', { query: 'needle' }, signal, () => undefined, { cwd: root, ui: { confirm } }),
      registered.get('document_list')!.execute('list', {}, signal, () => undefined, { cwd: root }),
    ]);
    expect(search).toMatchObject({ status: 'rejected', reason: { code: 'CACHE_STALE_DECLINED' } });
    expect(list).toMatchObject({ status: 'fulfilled' });
    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      'Design Docs cache is stale',
      'Rebuild the Design Docs search cache now?',
    );
    await close();
  });

  it('prompts for a stale digest and preserves cache bytes on decline', async () => {
    const { registered, close } = registeredTools();
    const root = fixture('prompt');
    const signal = new AbortController().signal;
    const invocation = { cwd: root };
    const createdResult = await registered
      .get('document_create')!
      .execute('create', { title: 'Digest', kind: 'hld', body: 'needle' }, signal, () => undefined, invocation);
    const created = JSON.parse(createdResult.content[0]?.text ?? '{}') as { id: string; revision: string };
    await registered
      .get('document_search')!
      .execute('search-1', { query: 'needle' }, signal, () => undefined, invocation);
    const cachePath = join(root, '.neottia/cache/design-docs.sqlite');
    const before = readFileSync(cachePath);
    await registered
      .get('document_update')!
      .execute(
        'update',
        { id: created.id, expected_revision: created.revision, body: 'changed needle' },
        signal,
        () => undefined,
        invocation,
      );
    const confirm = vi.fn(async () => false);
    await expect(
      registered
        .get('document_search')!
        .execute('search-2', { query: 'needle' }, signal, () => undefined, { cwd: root, ui: { confirm } }),
    ).rejects.toMatchObject({ category: 'cache', code: 'CACHE_STALE_DECLINED' });
    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      'Design Docs cache is stale',
      'Rebuild the Design Docs search cache now?',
    );
    expect(readFileSync(cachePath)).toEqual(before);
    await close();
  });

  it.each([
    [true, false],
    [false, true],
  ])('prompts before rebuilding a stale cache (accept=%s)', async (accept, declines) => {
    const { registered, close } = registeredTools();
    const root = fixture('prompt');
    const signal = new AbortController().signal;
    const invocation = { cwd: root };
    await registered
      .get('document_create')!
      .execute('create', { title: 'Searchable', kind: 'hld', body: 'needle' }, signal, () => undefined, invocation);
    await registered
      .get('document_search')!
      .execute('search-1', { query: 'needle' }, signal, () => undefined, invocation);
    const database = new DatabaseSync(join(root, '.neottia/cache/design-docs.sqlite'));
    database
      .prepare("UPDATE neottia_repository_cache_meta SET value=? WHERE key='rebuilt_at'")
      .run('2000-01-01T00:00:00.000Z');
    database.close();
    const confirm = vi.fn(async () => accept);
    const outcome = await registered
      .get('document_search')!
      .execute('search-2', { query: 'needle' }, signal, () => undefined, { cwd: root, ui: { confirm } })
      .then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
    const status =
      'error' in outcome
        ? { status: 'declined', code: (outcome.error as { code?: string }).code }
        : { status: 'accepted' };
    expect(status).toEqual(declines ? { status: 'declined', code: 'CACHE_STALE_DECLINED' } : { status: 'accepted' });
    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      'Design Docs cache is stale',
      'Rebuild the Design Docs search cache now?',
    );
    const check = new DatabaseSync(join(root, '.neottia/cache/design-docs.sqlite'), { readOnly: true });
    const row = check.prepare("SELECT value FROM neottia_repository_cache_meta WHERE key='rebuilt_at'").get() as {
      value: string;
    };
    check.close();
    expect(row.value === '2000-01-01T00:00:00.000Z').toBe(declines);
    await close();
  });
});
