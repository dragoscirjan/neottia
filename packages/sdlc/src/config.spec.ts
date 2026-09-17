import { createConfigRegistry, createResolvedConfigSnapshot, type ConfigShardValues } from '@neottia/config';
import { designDocsConfigContribution } from '@neottia/design-docs';
import { issueConfigContribution } from '@neottia/issues';
import { describe, expect, it } from 'vitest';
import { createSdlcCompilerContext, SdlcConfigError } from './compiler-context.js';
import {
  DOCUMENT_PROVIDERS,
  documentsCapabilityConfigContribution,
  documentsCapabilityConfigPatchSchema,
  documentsCapabilityConfigSchema,
  ISSUE_PROVIDERS,
  issuesCapabilityConfigContribution,
  issuesCapabilityConfigPatchSchema,
  issuesCapabilityConfigSchema,
  LOCAL_SOURCE_CONTROL_PROVIDERS,
  REMOTE_SOURCE_CONTROL_PROVIDERS,
  sourceControlCapabilityConfigContribution,
  sourceControlCapabilityConfigPatchSchema,
  sourceControlCapabilityConfigSchema,
} from './config.js';
import { forgeConnectionsConfigContribution } from './forge-config.js';

const registry = createConfigRegistry([
  issueConfigContribution,
  designDocsConfigContribution,
  forgeConnectionsConfigContribution,
  issuesCapabilityConfigContribution,
  documentsCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
]);

/** Creates a complete test snapshot with both filesystem modules enabled. */
function snapshot(values: ConfigShardValues = {}) {
  return createResolvedConfigSnapshot(registry, {
    issues: { enabled: true },
    'design-docs': { enabled: true },
    ...values,
  });
}

describe('SDLC capability schemas', () => {
  it('publishes stable provider sets and filesystem-first defaults', () => {
    expect(ISSUE_PROVIDERS).toEqual(['filesystem', 'github', 'gitlab', 'gitea', 'forgejo', 'jira']);
    expect(DOCUMENT_PROVIDERS).toEqual(['filesystem', 'github', 'gitlab', 'gitea', 'forgejo', 'confluence']);
    expect(LOCAL_SOURCE_CONTROL_PROVIDERS).toEqual(['git', 'jj']);
    expect(REMOTE_SOURCE_CONTROL_PROVIDERS).toEqual(['github', 'gitlab', 'gitea', 'forgejo', 'bitbucket']);
    expect(issuesCapabilityConfigSchema.parse({})).toEqual({ provider: 'filesystem' });
    expect(documentsCapabilityConfigSchema.parse({})).toEqual({ provider: 'filesystem' });
    expect(sourceControlCapabilityConfigSchema.parse({})).toEqual({
      local: 'git',
      remote: false,
      workspaces: false,
    });
  });

  it('accepts explicit selections without asking users for fixed provider facts', () => {
    expect(issuesCapabilityConfigSchema.parse({ provider: 'jira' })).toEqual({ provider: 'jira' });
    expect(documentsCapabilityConfigSchema.parse({ provider: 'confluence' })).toEqual({ provider: 'confluence' });
    expect(
      sourceControlCapabilityConfigSchema.parse({
        local: 'jj',
        remote: 'bitbucket',
        workspaces: false,
      }),
    ).toEqual({
      local: 'jj',
      remote: 'bitbucket',
      workspaces: false,
    });
  });

  it.each([
    [issuesCapabilityConfigSchema, { provider: 'unknown' }],
    [issuesCapabilityConfigSchema, { provider: 'filesystem', command: 'custom' }],
    [documentsCapabilityConfigSchema, { provider: 'filesystem', root: 'docs' }],
    [sourceControlCapabilityConfigSchema, { remote: { enabled: false, provider: 'github' } }],
    [sourceControlCapabilityConfigSchema, { remote: { enabled: true } }],
    [sourceControlCapabilityConfigSchema, { local: 'git', extra: true }],
  ])('rejects an unknown setting or obsolete remote object form %#', (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it('keeps every source patch default-free and closed', () => {
    expect(issuesCapabilityConfigPatchSchema.parse({})).toEqual({});
    expect(documentsCapabilityConfigPatchSchema.parse({})).toEqual({});
    expect(sourceControlCapabilityConfigPatchSchema.parse({ remote: 'github' })).toEqual({ remote: 'github' });
    expect(sourceControlCapabilityConfigPatchSchema.safeParse({ unknown: true }).success).toBe(false);
  });
});

describe('SDLC compiler context', () => {
  it('returns deeply immutable defaults from one snapshot', () => {
    const context = createSdlcCompilerContext(snapshot());

    expect(context).toEqual({
      issues: { provider: 'filesystem' },
      documents: { provider: 'filesystem' },
      sourceControl: { local: 'git', remote: { enabled: false }, workspaces: false },
      forges: [],
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.issues)).toBe(true);
    expect(Object.isFrozen(context.documents)).toBe(true);
    expect(Object.isFrozen(context.sourceControl)).toBe(true);
    expect(Object.isFrozen(context.sourceControl.remote)).toBe(true);
    expect(() => Object.assign(context.issues, { provider: 'github' })).toThrow(TypeError);
  });

  it('returns independent mixed-provider selections', () => {
    const service = { server: 'atlassian', command: 'mcp-remote' };
    const context = createSdlcCompilerContext(
      snapshot({
        'sdlc-issues-capability': { provider: 'jira' },
        'sdlc-documents-capability': { provider: 'confluence' },
        'sdlc-forge-connections': {
          github: {
            base_url: 'https://github.example.test',
            credential_environment: 'GITHUB_TOKEN',
          },
          bitbucket: {
            base_url: 'https://bitbucket.org/example',
            credential_environment: 'BITBUCKET_TOKEN',
            mcp: { remote_source_control: service },
          },
          jira: {
            base_url: 'https://example.atlassian.net',
            credential_environment: 'JIRA_TOKEN',
            mcp: { issues: service },
          },
          confluence: {
            base_url: 'https://example.atlassian.net/wiki',
            credential_environment: 'CONFLUENCE_TOKEN',
            mcp: { documents: service },
          },
        },
        'sdlc-source-control-capability': {
          local: 'jj',
          remote: 'bitbucket',
          workspaces: false,
        },
      }),
    );

    expect(context).toEqual({
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
          mcp: { remoteSourceControl: service },
        },
        {
          provider: 'confluence',
          capabilities: ['documents'],
          baseUrl: 'https://example.atlassian.net/wiki',
          credentialEnvironment: 'CONFLUENCE_TOKEN',
          allowInsecureHttp: false,
          mcp: { documents: service },
        },
        {
          provider: 'jira',
          capabilities: ['issues'],
          baseUrl: 'https://example.atlassian.net',
          credentialEnvironment: 'JIRA_TOKEN',
          allowInsecureHttp: false,
          mcp: { issues: service },
        },
      ],
    });
  });

  it('requires explicit opt-in before compiling an HTTP forge connection', () => {
    const values = {
      'sdlc-issues-capability': { provider: 'gitlab' },
      'sdlc-forge-connections': {
        gitlab: {
          base_url: 'http://gitlab.example.test',
          credential_environment: 'GITLAB_TOKEN',
        },
      },
    } satisfies ConfigShardValues;

    expect(() => createSdlcCompilerContext(snapshot(values))).toThrowError(
      expect.objectContaining({
        problems: expect.arrayContaining([expect.objectContaining({ code: 'FORGE_INSECURE_HTTP_REQUIRES_OPT_IN' })]),
      }),
    );
    expect(
      createSdlcCompilerContext(
        snapshot({
          ...values,
          'sdlc-forge-connections': {
            gitlab: { ...values['sdlc-forge-connections'].gitlab, allow_insecure_http: true },
          },
        }),
      ).forges[0]?.allowInsecureHttp,
    ).toBe(true);
  });

  it('rejects missing connections, unsupported documents, and required MCP services', () => {
    const invalid = snapshot({
      'sdlc-issues-capability': { provider: 'gitea' },
      'sdlc-documents-capability': { provider: 'gitea' },
      'sdlc-source-control-capability': { local: 'git', remote: 'forgejo', workspaces: false },
      'sdlc-forge-connections': {
        gitea: {
          base_url: 'https://gitea.example.test',
          credential_environment: 'GITEA_TOKEN',
        },
      },
    });

    expect(() => createSdlcCompilerContext(invalid)).toThrowError(
      expect.objectContaining({
        problems: expect.arrayContaining([
          expect.objectContaining({ code: 'FORGE_CAPABILITY_UNSUPPORTED' }),
          expect.objectContaining({ code: 'FORGE_CONNECTION_REQUIRED' }),
          expect.objectContaining({ code: 'FORGE_MCP_REQUIRED' }),
        ]),
      }),
    );
  });

  it('requires MCP for every selected Atlassian product capability', () => {
    const invalid = snapshot({
      'sdlc-issues-capability': { provider: 'jira' },
      'sdlc-documents-capability': { provider: 'confluence' },
      'sdlc-source-control-capability': { local: 'git', remote: 'bitbucket', workspaces: false },
      'sdlc-forge-connections': {
        jira: { base_url: 'https://example.atlassian.net', credential_environment: 'JIRA_TOKEN' },
        confluence: {
          base_url: 'https://example.atlassian.net/wiki',
          credential_environment: 'CONFLUENCE_TOKEN',
        },
        bitbucket: { base_url: 'https://bitbucket.org/example', credential_environment: 'BITBUCKET_TOKEN' },
      },
    });

    expect(() => createSdlcCompilerContext(invalid)).toThrowError(
      expect.objectContaining({
        problems: [
          expect.objectContaining({ code: 'FORGE_MCP_REQUIRED' }),
          expect.objectContaining({ code: 'FORGE_MCP_REQUIRED' }),
          expect.objectContaining({ code: 'FORGE_MCP_REQUIRED' }),
        ],
      }),
    );
  });

  it('reports every cross-shard conflict without rejected values', () => {
    const invalid = createResolvedConfigSnapshot(registry, {
      issues: { enabled: false },
      'design-docs': { enabled: false },
      'sdlc-source-control-capability': {
        local: 'jj',
        remote: false,
        workspaces: true,
      },
    });

    let thrown: unknown;
    try {
      createSdlcCompilerContext(invalid);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SdlcConfigError);
    const typed = thrown as SdlcConfigError;
    expect(typed.problems.map(({ code }) => code)).toEqual([
      'WORKSPACES_REQUIRE_GIT',
      'DOCUMENTS_MODULE_DISABLED',
      'ISSUES_MODULE_DISABLED',
    ]);
    expect(typed.problems.map(({ path }) => path)).toEqual([
      ['capabilities', 'source_control', 'workspaces'],
      ['modules', 'design_docs', 'enabled'],
      ['modules', 'issues', 'enabled'],
    ]);
    const serializedProblems = JSON.stringify(typed.problems);
    for (const rejectedValue of ['filesystem', 'jj']) {
      expect(serializedProblems).not.toContain(rejectedValue);
      expect(typed.message).not.toContain(rejectedValue);
    }
    expect(Object.isFrozen(typed.problems)).toBe(true);
    expect(Object.isFrozen(typed.problems[0]?.path)).toBe(true);
  });
});
