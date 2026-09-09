import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDesignDocsConfig } from './config.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
describe('skills.design_docs configuration', () => {
  it('uses per-leaf explicit > env > file > default precedence and strict keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neottia-doc-config-'));
    roots.push(root);
    await mkdir(join(root, '.neottia'));
    await writeFile(
      join(root, '.neottia/config.yml'),
      'version: 1\nskills:\n  design_docs:\n    enabled: true\n    retrieval:\n      limit: 9\n',
    );
    const loaded = loadDesignDocsConfig(root, {
      env: { NEOTTIA_DESIGN_DOCS_RETRIEVAL_LIMIT: '7' },
      retrieval: { limit: 5 },
    });
    expect(loaded).toMatchObject({ enabled: true, retrieval: { limit: 5, snippet_bytes: 512 } });
    await writeFile(
      join(root, '.neottia/config.yml'),
      'version: 1\nskills:\n  design_docs:\n    remote_provider: github\n',
    );
    expect(() => loadDesignDocsConfig(root, { env: {} })).toThrow(/Unrecognized key/u);
    await writeFile(
      join(root, '.neottia/config.yml'),
      'version: 1\nskills:\n  design_docs:\n    retrieval:\n      typo: true\n',
    );
    expect(() => loadDesignDocsConfig(root, { env: {} })).toThrow(/Unrecognized key/u);
  });

  it('rejects absolute and traversal roots', () => {
    expect(() => loadDesignDocsConfig('/tmp', { env: {}, root: '../escape' })).toThrow();
    expect(() => loadDesignDocsConfig('/tmp', { env: {}, root: '/tmp/designs' })).toThrow();
    for (const root of ['.neottia', '.neottia/cache', '.neottia/cache/docs', '.neottia/repository-store/docs'])
      expect(() => loadDesignDocsConfig('/tmp', { env: {}, root })).toThrow(/overlap/u);
  });
});
