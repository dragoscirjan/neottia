import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designDocsConfigContribution } from '@neottia/design-docs';
import { issueConfigContribution } from '@neottia/issues';
import { memoryConfigContribution } from '@neottia/memory-core';
import {
  createSdlcCompilerContext,
  documentsCapabilityConfigContribution,
  forgeConnectionsConfigContribution,
  issuesCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
} from '@neottia/sdlc';
import { searchableConfigContribution } from '@neottia/searchable-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assetInstallConfigContribution,
  harnessInstallConfigContribution,
  officialConfigContributions,
  officialConfigRegistry,
  resolveHostConfigSnapshot,
  templateInstallConfigContribution,
} from './index.js';

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
harnesses:
  install:
    targets:
      - id: pi
        scope: project
assets:
  install:
    static_skills: []
templates:
  install:
    packages: []
`);

    const snapshot = resolveHostConfigSnapshot({ cwd, env: {}, interactive: true });

    expect(officialConfigContributions.map(({ id }) => id)).toEqual([
      'memory',
      'issues',
      'design-docs',
      'searchable',
      'distribution-harness-install',
      'distribution-asset-install',
      'distribution-template-install',
      'sdlc-forge-connections',
      'sdlc-issues-capability',
      'sdlc-documents-capability',
      'sdlc-source-control-capability',
    ]);
    expect(officialConfigRegistry.contributions).toHaveLength(11);
    expect(snapshot.get(memoryConfigContribution).enabled).toBe(true);
    expect(snapshot.get(issueConfigContribution).enabled).toBe(true);
    expect(snapshot.get(designDocsConfigContribution).enabled).toBe(true);
    expect(snapshot.get(searchableConfigContribution).enabled).toBe(true);
    expect(snapshot.get(harnessInstallConfigContribution).targets).toEqual([{ id: 'pi', scope: 'project' }]);
    expect(snapshot.get(assetInstallConfigContribution).static_skills).toEqual([]);
    expect(snapshot.get(templateInstallConfigContribution)).toEqual({
      packages: [],
      global_overrides: [],
      project_overrides: [],
    });
    expect(snapshot.get(forgeConnectionsConfigContribution)).toEqual({});
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
