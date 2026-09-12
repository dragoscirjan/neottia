import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MemoryStore, loadMemoryConfig } from './index.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const packageReadme = readFileSync(join(repoRoot, 'packages/memory-core/README.md'), 'utf8');
const mcpReadme = readFileSync(join(repoRoot, 'packages/memory-mcp/README.md'), 'utf8');
const mcpGuide = readFileSync(join(repoRoot, 'docs/memory/mcp-server.md'), 'utf8');
const recordsGuide = readFileSync(join(repoRoot, 'docs/memory/records.md'), 'utf8');

describe('memory documentation contracts', () => {
  it('documents filesystem root isolation and PostgreSQL scope accurately', () => {
    for (const document of [mcpReadme, mcpGuide]) {
      expect(document).toMatch(/filesystem backend ignores (?:it|`namespace\.scope`)/u);
      expect(document).toMatch(/separate worktrees/u);
      expect(document).toMatch(/scope separates PostgreSQL/iu);
      expect(document).not.toMatch(/Give each workspace its own `NEOTTIA_MEMORY_NAMESPACE_SCOPE`/u);
    }
  });

  it('documents only the environment leaves that the loader binds', () => {
    expect(packageReadme).toMatch(/Environment variables override only the leaves listed below/u);
    expect(packageReadme).toMatch(
      /`security\.secret_patterns` and every `security\.limits` leaf are intentionally file\/code-only/u,
    );
    expect(packageReadme).not.toMatch(/every value can be overridden by an environment variable/u);
    expect(packageReadme).not.toMatch(/For every value:/u);
  });

  it('keeps the standalone lifecycle example executable', async () => {
    expect(packageReadme).toContain('const fact = {');
    expect(packageReadme).toContain('const replacement = await store.supersede(record.id');
    expect(packageReadme).toContain('await store.delete(replacement.id');

    const cwd = mkdtempSync(join(tmpdir(), 'neottia-memory-readme-'));
    const store = MemoryStore.fromConfig(loadMemoryConfig(cwd, { env: {}, enabled: true }), cwd);
    try {
      const fact = {
        memory_type: 'semantic' as const,
        record_type: 'fact' as const,
        summary: 'The site is deployed with pnpm, never npm',
        details: null,
        topic: 'tooling',
        source: { kind: 'user-confirmed' as const, ref: null, revision: null },
        created_by: 'agent:pi',
        confidence: 'confirmed' as const,
        tags: ['packaging'],
      };
      const record = await store.store(fact);
      const replacement = await store.supersede(record.id, {
        ...fact,
        summary: 'The site is deployed with pnpm; npm is blocked via packageManager',
      });
      await expect(
        store.delete(replacement.id, 'No longer applicable', replacement.source, 'agent:pi'),
      ).resolves.toMatchObject({ target_id: replacement.id });
    } finally {
      await store.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('ignores every disposable SQLite artifact but keeps YAML trackable', () => {
    for (const artifact of ['index.db', 'index.db-wal', 'index.db-shm']) {
      const path = `.neottia/memory/${artifact}`;
      expect(recordsGuide).toContain(path);
      expect(spawnSync('git', ['check-ignore', '--no-index', '--quiet', path], { cwd: repoRoot }).status).toBe(0);
    }
    expect(
      spawnSync('git', ['check-ignore', '--no-index', '--quiet', '.neottia/memory/facts/example.yaml'], {
        cwd: repoRoot,
      }).status,
    ).toBe(1);
  });
});
