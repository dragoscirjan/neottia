import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designDocsConfigContribution } from '@neottia/design-docs';
import { issueConfigContribution } from '@neottia/issues';
import { memoryConfigContribution } from '@neottia/memory-core';
import {
  createSdlcCompilerContext,
  documentsCapabilityConfigContribution,
  issuesCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
} from '@neottia/sdlc';
import { searchableConfigContribution } from '@neottia/searchable-core';
import { afterEach, describe, expect, it } from 'vitest';
import { officialConfigContributions, officialConfigRegistry, resolveHostConfigSnapshot } from './index.js';

const roots: string[] = [];

/** Creates an isolated root configuration integration fixture. */
function fixture(document: string): string {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-official-config-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.neottia'), { recursive: true });
  writeFileSync(join(cwd, '.neottia', 'config.yml'), document, 'utf8');
  return cwd;
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('official host configuration registry', () => {
  it('resolves a strict root containing every official module', () => {
    const cwd = fixture(`version: 1
modules:
  memory:
    enabled: true
  issues:
    enabled: true
  design_docs:
    enabled: true
  searchable:
    enabled: true
`);

    const snapshot = resolveHostConfigSnapshot({ cwd, env: {}, interactive: true });

    expect(officialConfigContributions.map(({ id }) => id)).toEqual([
      'memory',
      'issues',
      'design-docs',
      'searchable',
      'sdlc-issues-capability',
      'sdlc-documents-capability',
      'sdlc-source-control-capability',
    ]);
    expect(officialConfigRegistry.contributions).toHaveLength(7);
    expect(snapshot.get(memoryConfigContribution).enabled).toBe(true);
    expect(snapshot.get(issueConfigContribution).enabled).toBe(true);
    expect(snapshot.get(designDocsConfigContribution).enabled).toBe(true);
    expect(snapshot.get(searchableConfigContribution).enabled).toBe(true);
    expect(snapshot.get(issuesCapabilityConfigContribution)).toEqual({ provider: 'filesystem' });
    expect(snapshot.get(documentsCapabilityConfigContribution)).toEqual({ provider: 'filesystem' });
    expect(snapshot.get(sourceControlCapabilityConfigContribution)).toEqual({
      local: 'git',
      remote: false,
      workspaces: false,
    });
    expect(createSdlcCompilerContext(snapshot).issues.provider).toBe('filesystem');
  });

  it('rejects unknown modules even alongside official Searchable configuration', () => {
    const cwd = fixture(`version: 1
modules:
  searchable:
    enabled: true
  unknown:
    enabled: true
`);

    expect(() => resolveHostConfigSnapshot({ cwd, env: {}, interactive: true })).toThrowError(
      expect.objectContaining({
        diagnostics: expect.arrayContaining([expect.objectContaining({ path: ['modules', 'unknown'] })]),
      }),
    );
  });

  it('derives non-interactive policy without changing declared shards', () => {
    const cwd = fixture('version: 1\n');
    const declared = resolveHostConfigSnapshot({ cwd, env: {}, interactive: true });
    const effective = resolveHostConfigSnapshot({ cwd, interactive: false, snapshot: declared });

    expect(declared.get(memoryConfigContribution).cache.stale_policy).toBe('prompt');
    expect(declared.get(issueConfigContribution).cache.stale_policy).toBe('prompt');
    expect(declared.get(designDocsConfigContribution).cache.stale_policy).toBe('prompt');
    expect(declared.get(searchableConfigContribution).cache.stale_policy).toBe('prompt');
    expect(effective.get(memoryConfigContribution).cache.stale_policy).toBe('rebuild');
    expect(effective.get(issueConfigContribution).cache.stale_policy).toBe('rebuild');
    expect(effective.get(designDocsConfigContribution).cache.stale_policy).toBe('rebuild');
    expect(effective.get(searchableConfigContribution).cache.stale_policy).toBe('rebuild');
    expect(effective.sourceOf(issueConfigContribution, ['cache', 'stale_policy'])).toEqual({
      kind: 'override',
      label: 'non-interactive host stale-cache policy',
    });
  });
});
