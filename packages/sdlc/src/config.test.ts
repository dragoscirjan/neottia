import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigRegistry, resolveConfig } from '@neottia/config';
import { designDocsConfigContribution } from '@neottia/design-docs';
import { issueConfigContribution } from '@neottia/issues';
import { afterEach, describe, expect, it } from 'vitest';
import { createSdlcCompilerContext } from './compiler-context.js';
import {
  documentsCapabilityConfigContribution,
  issuesCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
} from './config.js';

const roots: string[] = [];
const registry = createConfigRegistry([
  issueConfigContribution,
  designDocsConfigContribution,
  issuesCapabilityConfigContribution,
  documentsCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
]);

/** Writes one project configuration beneath a disposable root. */
function fixture(document: string): string {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-sdlc-config-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.neottia'), { recursive: true });
  writeFileSync(join(cwd, '.neottia', 'config.yml'), document, 'utf8');
  return cwd;
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('resolved SDLC compiler configuration', () => {
  it('uses capability defaults when modules opt in', () => {
    const cwd = fixture(`version: 1
modules:
  issues:
    enabled: true
  design_docs:
    enabled: true
`);

    const snapshot = resolveConfig(registry, { cwd, env: {} });

    expect(createSdlcCompilerContext(snapshot)).toEqual({
      issues: { provider: 'filesystem' },
      documents: { provider: 'filesystem' },
      sourceControl: { local: 'git', remote: { enabled: false }, workspaces: false },
    });
  });

  it('applies profiles and retains leaf provenance', () => {
    const cwd = fixture(`version: 1
capabilities:
  issues:
    provider: github
  documents:
    provider: github
profiles:
  atlassian:
    capabilities:
      issues:
        provider: jira
      documents:
        provider: confluence
      source_control:
        local: jj
        remote: bitbucket
`);

    const snapshot = resolveConfig(registry, { cwd, env: { NEOTTIA_PROFILE: 'atlassian' } });

    expect(createSdlcCompilerContext(snapshot)).toEqual({
      issues: { provider: 'jira' },
      documents: { provider: 'confluence' },
      sourceControl: {
        local: 'jj',
        remote: { enabled: true, provider: 'bitbucket' },
        workspaces: false,
      },
    });
    expect(snapshot.sourceOf(issuesCapabilityConfigContribution, ['provider'])).toEqual({
      kind: 'profile',
      file: join(cwd, '.neottia', 'config.yml'),
      profile: 'atlassian',
    });
    expect(snapshot.sourceOf(sourceControlCapabilityConfigContribution, ['remote'])).toEqual({
      kind: 'profile',
      file: join(cwd, '.neottia', 'config.yml'),
      profile: 'atlassian',
    });
  });

  it('lets a profile atomically disable a lower remote selection', () => {
    const cwd = fixture(`version: 1
capabilities:
  issues:
    provider: github
  documents:
    provider: github
  source_control:
    remote: github
profiles:
  local:
    capabilities:
      source_control:
        remote: false
`);

    const snapshot = resolveConfig(registry, { cwd, env: { NEOTTIA_PROFILE: 'local' } });

    expect(snapshot.get(sourceControlCapabilityConfigContribution).remote).toBe(false);
    expect(snapshot.sourceOf(sourceControlCapabilityConfigContribution, ['remote'])).toEqual({
      kind: 'profile',
      file: join(cwd, '.neottia', 'config.yml'),
      profile: 'local',
    });
  });

  it('does not reread configuration after snapshot resolution', () => {
    const cwd = fixture(`version: 1
capabilities:
  issues:
    provider: github
  documents:
    provider: confluence
`);
    const path = join(cwd, '.neottia', 'config.yml');
    const snapshot = resolveConfig(registry, { cwd, env: {} });

    writeFileSync(
      path,
      `version: 1
capabilities:
  issues:
    provider: gitlab
  documents:
    provider: gitlab
`,
      'utf8',
    );

    expect(createSdlcCompilerContext(snapshot)).toEqual({
      issues: { provider: 'github' },
      documents: { provider: 'confluence' },
      sourceControl: { local: 'git', remote: { enabled: false }, workspaces: false },
    });
  });

  it('rejects unknown keys and the non-atomic remote object form', () => {
    const unknown = fixture(`version: 1
capabilities:
  issues:
    provider: filesystem
    command: custom
`);
    const nonAtomic = fixture(`version: 1
capabilities:
  source_control:
    remote:
      enabled: false
      provider: github
`);

    expect(() => resolveConfig(registry, { cwd: unknown, env: {} })).toThrowError(
      expect.objectContaining({
        diagnostics: expect.arrayContaining([expect.objectContaining({ path: ['capabilities', 'issues', 'command'] })]),
      }),
    );
    expect(() => resolveConfig(registry, { cwd: nonAtomic, env: {} })).toThrowError(
      expect.objectContaining({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ path: ['capabilities', 'source_control', 'remote'] }),
        ]),
      }),
    );
  });
});
