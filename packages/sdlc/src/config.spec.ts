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

const registry = createConfigRegistry([
  issueConfigContribution,
  designDocsConfigContribution,
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
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.issues)).toBe(true);
    expect(Object.isFrozen(context.documents)).toBe(true);
    expect(Object.isFrozen(context.sourceControl)).toBe(true);
    expect(Object.isFrozen(context.sourceControl.remote)).toBe(true);
    expect(() => Object.assign(context.issues, { provider: 'github' })).toThrow(TypeError);
  });

  it('returns explicit remote selections', () => {
    const context = createSdlcCompilerContext(
      snapshot({
        'sdlc-issues-capability': { provider: 'github' },
        'sdlc-documents-capability': { provider: 'confluence' },
        'sdlc-source-control-capability': {
          local: 'jj',
          remote: 'bitbucket',
          workspaces: false,
        },
      }),
    );

    expect(context).toEqual({
      issues: { provider: 'github' },
      documents: { provider: 'confluence' },
      sourceControl: {
        local: 'jj',
        remote: { enabled: true, provider: 'bitbucket' },
        workspaces: false,
      },
    });
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
