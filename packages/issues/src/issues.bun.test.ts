import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { issueConfigSchema } from './config.js';
import { IssueStore } from './store.js';

describe('Issues Bun SQLite runtime', () => {
  it('rebuilds FTS5 and hydrates canonical YAML in a disposable project', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'neottia-issues-bun-'));
    try {
      const store = new IssueStore(issueConfigSchema.parse({ enabled: true, cache: { stale_policy: 'rebuild' } }), cwd);
      const created = await store.create({ type: 'task', title: 'Bun runtime', body: 'cross runtime search' });
      expect((await store.search('runtime')).map((issue) => issue.id)).toEqual([created.id]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
