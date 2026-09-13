import { readFileSync, writeFileSync } from 'node:fs';
import { HOST_FEATURES } from '@neottia/harness-adapter';
import { piHarnessAdapter } from '@neottia/pi-adapter';
import {
  assertHarnessAdapterConformance,
  createTempHarnessEnvironment,
  materializeHostConfigPlan,
  resolveHarnessTarget,
} from '@neottia/testkit';
import { describe, expect, it } from 'vitest';
import { opencodeHarnessAdapter, opencodeHarnessDeclaration } from './index.js';

describe('OpenCode harness adapter', () => {
  it('passes the shared adapter conformance contract', () => {
    expect(() => assertHarnessAdapterConformance(opencodeHarnessAdapter)).not.toThrow();
  });

  it('declares every feature and only rejects undocumented metadata', () => {
    expect(Object.keys(opencodeHarnessDeclaration.features)).toEqual(HOST_FEATURES);
    expect(opencodeHarnessDeclaration.features['asset.agent'].status).toBe('supported');
    expect(opencodeHarnessDeclaration.features['config.mcp.local'].status).toBe('supported');
    expect(opencodeHarnessDeclaration.features['prompt.argument-hint'].status).toBe('unsupported');
    expect(opencodeHarnessDeclaration.features['agent.steps'].status).toBe('supported');
    expect(opencodeHarnessDeclaration.features['agent.thinking'].status).toBe('unsupported');
    expect(opencodeHarnessDeclaration.testedHostVersions).toEqual([]);
  });

  it('projects project and global resource paths plus config candidates', () => {
    expect(opencodeHarnessAdapter.target({ feature: 'asset.prompt', scope: 'project', assetId: 'plan' }).value).toEqual(
      {
        anchor: 'project',
        segments: ['.opencode', 'commands', 'plan.md'],
      },
    );
    expect(
      opencodeHarnessAdapter.target({ feature: 'asset.agent', scope: 'global', assetId: 'planner' }).value,
    ).toEqual({
      anchor: 'xdg-config',
      segments: ['opencode', 'agents', 'planner.md'],
    });
    expect(opencodeHarnessAdapter.target({ feature: 'config.package', scope: 'project' }).value).toEqual({
      candidates: [
        { anchor: 'project', segments: ['opencode.json'] },
        { anchor: 'project', segments: ['opencode.jsonc'] },
      ],
      createAt: { anchor: 'project', segments: ['opencode.json'] },
    });
  });

  it('renders command and native agent metadata in stable order', () => {
    const prompt = opencodeHarnessAdapter.projectPrompt({
      id: 'plan',
      scope: 'project',
      body: 'Plan this change.\n',
      metadata: {
        description: 'Plan a change',
        execution: { agent: 'planner', model: 'openai/gpt', subtask: true },
      },
    });
    expect(prompt.value?.content).toBe(
      '---\ndescription: "Plan a change"\nagent: "planner"\nmodel: "openai/gpt"\nsubtask: true\n---\nPlan this change.\n',
    );
    const agent = opencodeHarnessAdapter.projectAgent({
      id: 'reviewer',
      scope: 'project',
      body: 'Review the change.\n',
      description: 'Reviews code',
      mode: 'subagent',
      modelHint: 'openai/gpt',
      steps: 12,
      permissions: { write: 'deny', read: 'allow' },
    });
    expect(agent.value?.content).toBe(
      '---\ndescription: "Reviews code"\nmode: "subagent"\nmodel: "openai/gpt"\nsteps: 12\npermission: {"read":"allow","write":"deny"}\n---\nReview the change.\n',
    );
    expect(
      opencodeHarnessAdapter.projectAgent({
        id: 'reviewer',
        scope: 'project',
        body: 'Review.\n',
        description: 'Reviews code',
        mode: 'subagent',
        thinkingHint: 'high',
      }).diagnostics,
    ).toMatchObject([{ code: 'UNREPRESENTABLE_METADATA', feature: 'agent.thinking' }]);
  });

  it('produces exact local and remote MCP operation shapes', () => {
    const local = opencodeHarnessAdapter.planHostConfiguration({
      kind: 'mcp.local',
      scope: 'project',
      server: {
        name: 'neottia-issues',
        command: ['node', 'issues.js'],
        cwd: '.neottia/bin',
        environment: { TOKEN: '{env:ISSUES_TOKEN}' },
        enabled: true,
        timeout: 5000,
      },
    });
    expect(local.value?.operations[0]).toEqual({
      id: 'mcp:neottia-issues',
      kind: 'ensure-object-entry',
      pointer: '/mcp',
      key: 'neottia-issues',
      owner: 'neottia',
      value: {
        type: 'local',
        command: ['node', 'issues.js'],
        cwd: '.neottia/bin',
        environment: { TOKEN: '{env:ISSUES_TOKEN}' },
        enabled: true,
        timeout: 5000,
      },
    });

    const remote = opencodeHarnessAdapter.planHostConfiguration({
      kind: 'mcp.remote',
      scope: 'global',
      server: {
        name: 'remote-docs',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer {env:DOCS_TOKEN}' },
        oauth: false,
      },
    });
    expect(remote.value?.operations[0]).toMatchObject({
      kind: 'ensure-object-entry',
      pointer: '/mcp',
      key: 'remote-docs',
      value: {
        type: 'remote',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer {env:DOCS_TOKEN}' },
        oauth: false,
      },
    });
  });

  it('preserves unrelated config during test-only materialization', () => {
    const environment = createTempHarnessEnvironment();
    try {
      const declaration = opencodeHarnessAdapter.declarePackage({
        logicalId: 'memory',
        scope: 'project',
        version: '1.2.3',
      }).value!;
      const plan = opencodeHarnessAdapter.planHostConfiguration({ kind: 'package', package: declaration }).value!;
      const target = resolveHarnessTarget(environment, plan.target.createAt);
      writeFileSync(target, '{"theme":"dark","plugin":["operator-plugin"]}\n', 'utf8');
      materializeHostConfigPlan(environment, plan);
      expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({
        theme: 'dark',
        plugin: ['operator-plugin', '@neottia/opencode-memory@1.2.3'],
      });
    } finally {
      environment.cleanup();
    }
  });

  it('enforces Agent Skills frontmatter boundaries for both hosts', () => {
    const base = {
      scope: 'project' as const,
      description: 'Review code.',
      body: '# Review\n',
    };
    for (const adapter of [piHarnessAdapter, opencodeHarnessAdapter]) {
      expect(adapter.projectSkill({ ...base, id: 'a'.repeat(64), compatibility: 'a'.repeat(500) }).value).toBeDefined();
      expect(adapter.projectSkill({ ...base, id: 'a'.repeat(65) }).diagnostics).toMatchObject([
        { code: 'INVALID_ASSET_ID' },
      ]);
      expect(adapter.projectSkill({ ...base, id: 'review', compatibility: 'a'.repeat(501) }).diagnostics).toMatchObject(
        [{ code: 'INVALID_CONTENT' }],
      );
      expect(adapter.projectSkill({ ...base, id: 'review', compatibility: '   ' }).diagnostics).toMatchObject([
        { code: 'INVALID_CONTENT' },
      ]);
    }
  });

  it('rejects malformed runtime requests without throwing or dropping values', () => {
    const calls = [
      () => opencodeHarnessAdapter.target({ feature: 'asset.unknown', scope: 'project', assetId: 'plan' } as never),
      () =>
        opencodeHarnessAdapter.projectPrompt({
          id: 'plan',
          scope: 'project',
          body: 'Plan.\n',
          metadata: { execution: { subtask: 'yes' } },
        } as never),
      () =>
        opencodeHarnessAdapter.projectSkill({
          id: 'review',
          scope: 'project',
          description: 'Review.',
          body: 'Review.\n',
          metadata: { owner: false },
        } as never),
      () => opencodeHarnessAdapter.projectExtension({ id: 'plugin', scope: 'workspace', source: 'export {}' } as never),
      () =>
        opencodeHarnessAdapter.projectAgent({
          id: 'reviewer',
          scope: 'project',
          body: 'Review.\n',
          description: 'Review.',
          mode: 'worker',
          steps: 'ten',
          permissions: { write: 'sometimes' },
        } as never),
      () =>
        opencodeHarnessAdapter.declarePackage({ logicalId: 'unknown', scope: 'project', version: '1.2.3' } as never),
      () => opencodeHarnessAdapter.planHostConfiguration({ kind: 'unknown' } as never),
      () =>
        opencodeHarnessAdapter.planHostConfiguration({
          kind: 'package',
          package: {
            logicalId: 'memory',
            scope: 'project',
            source: { ecosystem: 'npm', name: '@neottia/opencode-memory', version: '1.2.3' },
            activation: 'opencode-plugin',
            provides: [],
          },
        } as never),
      () =>
        opencodeHarnessAdapter.planHostConfiguration({
          kind: 'mcp.local',
          scope: 'project',
          server: { name: 'issues', command: ['node', 1], enabled: 'yes' },
        } as never),
      () =>
        opencodeHarnessAdapter.planHostConfiguration({
          kind: 'mcp.remote',
          scope: 'project',
          server: { name: 'issues', url: 'https://example.test', enabled: 1 },
        } as never),
      () => opencodeHarnessAdapter.reloadNotice({ changedFeatures: ['asset.unknown'] } as never),
    ];
    for (const call of calls) {
      expect(call).not.toThrow();
      const result = call();
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toMatchObject([{ code: 'INVALID_REQUEST' }]);
    }
  });

  it('emits byte-equivalent shared skill files for Pi and OpenCode', () => {
    const request = {
      id: 'code-review',
      scope: 'project' as const,
      description: 'Review code changes.',
      body: '# Review\n\nInspect the diff.\n',
      license: 'MIT',
      metadata: { owner: 'neottia' },
    };
    expect(opencodeHarnessAdapter.projectSkill(request).value?.content).toBe(
      piHarnessAdapter.projectSkill(request).value?.content,
    );
  });

  it('diagnoses unsupported prompt hints and recommends restart as adapter policy', () => {
    const unsupported = opencodeHarnessAdapter.projectPrompt({
      id: 'plan',
      scope: 'project',
      body: 'Plan.\n',
      metadata: { argumentHint: '<issue>' },
    });
    expect(unsupported.value).toBeUndefined();
    expect(unsupported.diagnostics).toMatchObject([
      { code: 'UNREPRESENTABLE_METADATA', feature: 'prompt.argument-hint' },
    ]);
    expect(opencodeHarnessAdapter.reloadNotice({ changedFeatures: ['asset.prompt'] }).value).toMatchObject({
      action: 'restart',
    });
    expect(opencodeHarnessAdapter.reloadNotice({ changedFeatures: ['asset.prompt'] }).value?.message).toContain(
      'adapter policy',
    );
  });
});
