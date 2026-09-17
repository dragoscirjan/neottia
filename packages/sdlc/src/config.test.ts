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
import { forgeConnectionsConfigContribution } from './forge-config.js';

const roots: string[] = [];
const registry = createConfigRegistry([
  issueConfigContribution,
  designDocsConfigContribution,
  forgeConnectionsConfigContribution,
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
      forges: [],
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
    connections:
      forges:
        bitbucket:
          base_url: https://bitbucket.org/example
          credential_environment: BITBUCKET_TOKEN
          mcp:
            remote_source_control:
              server: atlassian
              command: mcp-remote
        jira:
          base_url: https://example.atlassian.net
          credential_environment: JIRA_TOKEN
          mcp:
            issues:
              server: atlassian
              command: mcp-remote
        confluence:
          base_url: https://example.atlassian.net/wiki
          credential_environment: CONFLUENCE_TOKEN
          mcp:
            documents:
              server: atlassian
              command: mcp-remote
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
      forges: [
        {
          provider: 'bitbucket',
          capabilities: ['remote-source-control'],
          baseUrl: 'https://bitbucket.org/example',
          credentialEnvironment: 'BITBUCKET_TOKEN',
          allowInsecureHttp: false,
          mcp: { remoteSourceControl: { server: 'atlassian', command: 'mcp-remote' } },
        },
        {
          provider: 'confluence',
          capabilities: ['documents'],
          baseUrl: 'https://example.atlassian.net/wiki',
          credentialEnvironment: 'CONFLUENCE_TOKEN',
          allowInsecureHttp: false,
          mcp: { documents: { server: 'atlassian', command: 'mcp-remote' } },
        },
        {
          provider: 'jira',
          capabilities: ['issues'],
          baseUrl: 'https://example.atlassian.net',
          credentialEnvironment: 'JIRA_TOKEN',
          allowInsecureHttp: false,
          mcp: { issues: { server: 'atlassian', command: 'mcp-remote' } },
        },
      ],
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
    expect(snapshot.sourceOf(forgeConnectionsConfigContribution, ['jira', 'base_url'])).toEqual({
      kind: 'profile',
      file: join(cwd, '.neottia', 'config.yml'),
      profile: 'atlassian',
    });
  });

  it('selects only the active profile connection and retains its provenance', () => {
    const cwd = fixture(`version: 1
modules:
  design_docs:
    enabled: true
capabilities:
  issues:
    provider: github
connections:
  forges:
    github:
      base_url: https://github.com
      credential_environment: GITHUB_TOKEN
profiles:
  self-hosted:
    capabilities:
      issues:
        provider: gitlab
    connections:
      forges:
        gitlab:
          base_url: https://gitlab.example.test/root/
          credential_environment: GITLAB_TOKEN
`);

    const snapshot = resolveConfig(registry, { cwd, env: { NEOTTIA_PROFILE: 'self-hosted' } });
    const context = createSdlcCompilerContext(snapshot);

    expect(context.forges).toEqual([
      {
        provider: 'gitlab',
        capabilities: ['issues'],
        baseUrl: 'https://gitlab.example.test/root/',
        credentialEnvironment: 'GITLAB_TOKEN',
        allowInsecureHttp: false,
        mcp: {},
      },
    ]);
    expect(snapshot.sourceOf(forgeConnectionsConfigContribution, ['gitlab', 'base_url'])).toEqual({
      kind: 'profile',
      file: join(cwd, '.neottia', 'config.yml'),
      profile: 'self-hosted',
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
    provider: github
connections:
  forges:
    github:
      base_url: https://github.example.test
      credential_environment: GITHUB_TOKEN
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
      documents: { provider: 'github' },
      sourceControl: { local: 'git', remote: { enabled: false }, workspaces: false },
      forges: [
        {
          provider: 'github',
          capabilities: ['documents', 'issues'],
          baseUrl: 'https://github.example.test',
          credentialEnvironment: 'GITHUB_TOKEN',
          allowInsecureHttp: false,
          mcp: {},
        },
      ],
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
