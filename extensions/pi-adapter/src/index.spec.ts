import { HOST_FEATURES } from '@neottia/harness-adapter';
import { assertHarnessAdapterConformance } from '@neottia/testkit';
import { describe, expect, it } from 'vitest';
import { piHarnessAdapter, piHarnessDeclaration } from './index.js';

describe('Pi harness adapter', () => {
  it('passes the shared adapter conformance contract', () => {
    expect(() => assertHarnessAdapterConformance(piHarnessAdapter)).not.toThrow();
  });

  it('declares every feature and the native Pi limitations', () => {
    expect(Object.keys(piHarnessDeclaration.features)).toEqual(HOST_FEATURES);
    expect(piHarnessDeclaration.features['asset.agent']).toMatchObject({ status: 'unsupported', scopes: [] });
    expect(piHarnessDeclaration.features['config.mcp.local']).toMatchObject({ status: 'unsupported', scopes: [] });
    expect(piHarnessDeclaration.features['config.mcp.remote']).toMatchObject({ status: 'unsupported', scopes: [] });
    expect(piHarnessDeclaration.features['agent.steps']).toMatchObject({ status: 'unsupported', scopes: [] });
    expect(piHarnessDeclaration.testedHostVersions).toEqual([]);
  });

  it('projects project and global resource paths', () => {
    expect(piHarnessAdapter.target({ feature: 'asset.prompt', scope: 'project', assetId: 'plan' }).value).toEqual({
      anchor: 'project',
      segments: ['.pi', 'prompts', 'plan.md'],
    });
    expect(piHarnessAdapter.target({ feature: 'asset.skill', scope: 'global', assetId: 'review' }).value).toEqual({
      anchor: 'home',
      segments: ['.pi', 'agent', 'skills', 'review', 'SKILL.md'],
    });
    expect(piHarnessAdapter.target({ feature: 'asset.extension', scope: 'global', assetId: 'neottia' }).value).toEqual({
      anchor: 'home',
      segments: ['.pi', 'agent', 'extensions', 'neottia.ts'],
    });
  });

  it('renders supported prompt metadata and rejects execution metadata', () => {
    const prompt = piHarnessAdapter.projectPrompt({
      id: 'plan',
      scope: 'project',
      body: 'Plan this change.\n',
      metadata: { description: 'Plan a change', argumentHint: '<issue>' },
    });
    expect(prompt.value?.content).toBe(
      '---\ndescription: "Plan a change"\nargument-hint: "<issue>"\n---\nPlan this change.\n',
    );

    const unsupported = piHarnessAdapter.projectPrompt({
      id: 'plan',
      scope: 'project',
      body: 'Plan.\n',
      metadata: { execution: { agent: 'planner', model: 'provider/model', subtask: true } },
    });
    expect(unsupported.value).toBeUndefined();
    expect(unsupported.diagnostics.map((problem) => problem.feature)).toEqual([
      'prompt.agent',
      'prompt.model',
      'prompt.subtask',
    ]);
  });

  it('maps logical packages to reviewable Pi settings operations', () => {
    const declaration = piHarnessAdapter.declarePackage({ logicalId: 'issues', scope: 'project', version: '1.2.3' });
    expect(declaration.value?.source.name).toBe('@neottia/pi-issues');
    const plan = piHarnessAdapter.planHostConfiguration({ kind: 'package', package: declaration.value! });
    expect(plan.value).toEqual({
      hostId: 'pi',
      scope: 'project',
      target: {
        candidates: [{ anchor: 'project', segments: ['.pi', 'settings.json'] }],
        createAt: { anchor: 'project', segments: ['.pi', 'settings.json'] },
      },
      operations: [
        {
          id: 'package:issues',
          kind: 'ensure-array-entry',
          pointer: '/packages',
          identity: 'npm:@neottia/pi-issues',
          value: 'npm:@neottia/pi-issues@1.2.3',
          owner: 'neottia',
        },
      ],
    });
    expect(Object.isFrozen(plan.value?.operations)).toBe(true);
  });

  it('rejects MCP and agents without emitting guessed output', () => {
    const mcp = piHarnessAdapter.planHostConfiguration({
      kind: 'mcp.local',
      scope: 'project',
      server: { name: 'issues', command: ['node', 'server.js'] },
    });
    expect(mcp.value).toBeUndefined();
    expect(mcp.diagnostics).toMatchObject([{ code: 'UNSUPPORTED_HOST_FEATURE' }]);
    const agent = piHarnessAdapter.projectAgent({
      id: 'planner',
      scope: 'project',
      body: 'Plan.\n',
      description: 'Plans work',
      mode: 'primary',
    });
    expect(agent.value).toBeUndefined();
    expect(agent.diagnostics).toMatchObject([{ code: 'UNSUPPORTED_HOST_FEATURE' }]);
  });

  it('rejects malformed runtime requests before host projection', () => {
    const calls = [
      () => piHarnessAdapter.target({ feature: 'asset.prompt', scope: 'workspace', assetId: 'plan' } as never),
      () =>
        piHarnessAdapter.projectPrompt({
          id: 'plan',
          scope: 'project',
          body: 'Plan.\n',
          metadata: { execution: { subtask: 'yes' } },
        } as never),
      () =>
        piHarnessAdapter.projectSkill({
          id: 'review',
          scope: 'project',
          description: 'Review.',
          body: 'Review.\n',
          metadata: { owner: 1 },
        } as never),
      () => piHarnessAdapter.projectExtension({ id: 'plugin', scope: 'project', source: false } as never),
      () =>
        piHarnessAdapter.projectAgent({
          id: 'planner',
          scope: 'project',
          body: 'Plan.\n',
          description: 'Plan.',
          mode: 'worker',
        } as never),
      () => piHarnessAdapter.declarePackage({ logicalId: 'issues', scope: 'workspace', version: '1.2.3' } as never),
      () => piHarnessAdapter.planHostConfiguration({ kind: 'unknown' } as never),
      () =>
        piHarnessAdapter.planHostConfiguration({
          kind: 'mcp.local',
          scope: 'project',
          server: { name: 'issues', command: 'node', enabled: 'yes' },
        } as never),
      () => piHarnessAdapter.reloadNotice({ changedFeatures: ['asset.unknown'] } as never),
    ];
    for (const call of calls) {
      expect(call).not.toThrow();
      const result = call();
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toMatchObject([{ code: 'INVALID_REQUEST' }]);
    }
  });

  it('uses exact SemVer 2 package versions', () => {
    expect(
      piHarnessAdapter.declarePackage({ logicalId: 'issues', scope: 'project', version: '1.2.3-rc.1+build.5' }).value
        ?.source.version,
    ).toBe('1.2.3-rc.1+build.5');
    expect(
      piHarnessAdapter.declarePackage({ logicalId: 'issues', scope: 'project', version: '01.2.3' }).diagnostics,
    ).toMatchObject([{ code: 'INVALID_PACKAGE_DECLARATION' }]);
  });

  it('distinguishes resource reload from package activation restart', () => {
    expect(piHarnessAdapter.reloadNotice({ changedFeatures: ['asset.skill', 'asset.prompt'] }).value).toMatchObject({
      action: 'command',
      command: '/reload',
    });
    expect(piHarnessAdapter.reloadNotice({ changedFeatures: ['config.package'] }).value).toMatchObject({
      action: 'restart',
    });
  });
});
