import { readFileSync, writeFileSync } from 'node:fs';
import { HOST_FEATURES } from '@neottia/harness-adapter';
import {
  assertHarnessAdapterConformance,
  createTempHarnessEnvironment,
  materializeHostConfigPlan,
  resolveHarnessTarget,
} from '@neottia/testkit';
import { describe, expect, it } from 'vitest';
import { claudeCodeHarnessAdapter, claudeCodeHarnessDeclaration } from './index.js';

describe('Claude Code harness adapter', () => {
  it('passes the shared adapter conformance contract', () => {
    expect(() => assertHarnessAdapterConformance(claudeCodeHarnessAdapter)).not.toThrow();
  });

  it('declares every feature and distinguishes project-only MCP support', () => {
    expect(Object.keys(claudeCodeHarnessDeclaration.features)).toEqual(HOST_FEATURES);
    expect(claudeCodeHarnessDeclaration.features['asset.agent'].status).toBe('supported');
    expect(claudeCodeHarnessDeclaration.features['asset.extension'].status).toBe('unsupported');
    expect(claudeCodeHarnessDeclaration.features['config.package'].status).toBe('unsupported');
    expect(claudeCodeHarnessDeclaration.features['config.mcp.local']).toMatchObject({
      status: 'supported',
      scopes: ['project'],
    });
    expect(claudeCodeHarnessDeclaration.features['agent.permissions'].status).toBe('unsupported');
    expect(claudeCodeHarnessDeclaration.features['agent.thinking'].status).toBe('supported');
    expect(claudeCodeHarnessDeclaration.testedHostVersions).toEqual([]);
  });

  it('projects documented project and user asset paths', () => {
    expect(
      claudeCodeHarnessAdapter.target({ feature: 'asset.prompt', scope: 'project', assetId: 'plan' }).value,
    ).toEqual({ anchor: 'project', segments: ['.claude', 'commands', 'plan.md'] });
    expect(
      claudeCodeHarnessAdapter.target({ feature: 'asset.skill', scope: 'global', assetId: 'review' }).value,
    ).toEqual({ anchor: 'home', segments: ['.claude', 'skills', 'review', 'SKILL.md'] });
    expect(
      claudeCodeHarnessAdapter.target({ feature: 'asset.agent', scope: 'global', assetId: 'planner' }).value,
    ).toEqual({ anchor: 'home', segments: ['.claude', 'agents', 'planner.md'] });
    expect(claudeCodeHarnessAdapter.target({ feature: 'config.mcp.local', scope: 'project' }).value).toEqual({
      candidates: [{ anchor: 'project', segments: ['.mcp.json'] }],
      createAt: { anchor: 'project', segments: ['.mcp.json'] },
    });
    expect(claudeCodeHarnessAdapter.target({ feature: 'config.mcp.local', scope: 'global' }).diagnostics).toMatchObject(
      [{ code: 'UNSUPPORTED_SCOPE' }],
    );
  });

  it('renders command and agent metadata without granting permissions', () => {
    const prompt = claudeCodeHarnessAdapter.projectPrompt({
      id: 'plan',
      scope: 'project',
      body: 'Plan this change.\n',
      metadata: {
        description: 'Plan a change',
        argumentHint: '<issue>',
        execution: { model: 'sonnet' },
      },
    });
    expect(prompt.value?.content).toBe(
      '---\ndescription: "Plan a change"\nargument-hint: "<issue>"\nmodel: "sonnet"\n---\nPlan this change.\n',
    );
    expect(prompt.value?.content).not.toContain('context');

    const forked = claudeCodeHarnessAdapter.projectPrompt({
      id: 'plan',
      scope: 'project',
      body: 'Plan this change.\n',
      metadata: { execution: { subtask: true } },
    });
    expect(forked.value?.content).toBe('---\ncontext: "fork"\n---\nPlan this change.\n');

    const routed = claudeCodeHarnessAdapter.projectPrompt({
      id: 'plan',
      scope: 'project',
      body: 'Plan this change.\n',
      metadata: { execution: { agent: 'neottia-planner' } },
    });
    expect(routed.value?.content).toBe('---\ncontext: "fork"\nagent: "neottia-planner"\n---\nPlan this change.\n');

    const agent = claudeCodeHarnessAdapter.projectAgent({
      id: 'reviewer',
      scope: 'project',
      body: 'Review the change.\n',
      description: 'Reviews code',
      mode: 'subagent',
      modelHint: 'sonnet',
      thinkingHint: 'high',
      steps: 12,
    });
    expect(agent.value?.content).toBe(
      '---\nname: "reviewer"\ndescription: "Reviews code"\nmodel: "sonnet"\neffort: "high"\nmaxTurns: 12\n---\nReview the change.\n',
    );
    expect(agent.value?.content).not.toContain('permission');

    expect(
      claudeCodeHarnessAdapter.projectAgent({
        id: 'reviewer',
        scope: 'project',
        body: 'Review.\n',
        description: 'Reviews code',
        mode: 'subagent',
        permissions: { write: 'deny' },
      }).diagnostics,
    ).toMatchObject([{ code: 'UNREPRESENTABLE_METADATA', feature: 'agent.permissions' }]);
  });

  it('rejects blank command routing values without emitting them', () => {
    const result = claudeCodeHarnessAdapter.projectPrompt({
      id: 'plan',
      scope: 'project',
      body: 'Plan.\n',
      metadata: { execution: { agent: '   ', model: ' ' } },
    });
    expect(result.value).toBeUndefined();
    expect(result.diagnostics).toMatchObject([
      { code: 'INVALID_CONTENT', feature: 'prompt.agent' },
      { code: 'INVALID_CONTENT', feature: 'prompt.model' },
    ]);
  });

  it('produces exact project MCP operation shapes', () => {
    const local = claudeCodeHarnessAdapter.planHostConfiguration({
      kind: 'mcp.local',
      scope: 'project',
      server: {
        name: 'neottia-issues',
        command: ['node', 'issues.js'],
        environment: { TOKEN: '{env:ISSUES_TOKEN}' },
        timeout: 5000,
      },
    });
    expect(local.value?.operations[0]).toEqual({
      id: 'mcp:neottia-issues',
      kind: 'ensure-object-entry',
      pointer: '/mcpServers',
      key: 'neottia-issues',
      owner: 'neottia',
      value: {
        type: 'stdio',
        command: 'node',
        args: ['issues.js'],
        env: { TOKEN: '{env:ISSUES_TOKEN}' },
        timeout: 5000,
      },
    });

    const remote = claudeCodeHarnessAdapter.planHostConfiguration({
      kind: 'mcp.remote',
      scope: 'project',
      server: {
        name: 'remote-docs',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer {env:DOCS_TOKEN}' },
      },
    });
    expect(remote.value?.operations[0]).toEqual({
      id: 'mcp:remote-docs',
      kind: 'ensure-object-entry',
      pointer: '/mcpServers',
      key: 'remote-docs',
      owner: 'neottia',
      value: {
        type: 'http',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer {env:DOCS_TOKEN}' },
      },
    });
  });

  it('preserves unrelated project MCP configuration during materialization', () => {
    const environment = createTempHarnessEnvironment();
    try {
      const plan = claudeCodeHarnessAdapter.planHostConfiguration({
        kind: 'mcp.local',
        scope: 'project',
        server: { name: 'issues', command: ['node', 'issues.js'] },
      }).value!;
      const target = resolveHarnessTarget(environment, plan.target.createAt);
      writeFileSync(
        target,
        '{"theme":"dark","mcpServers":{"operator":{"type":"http","url":"https://example.test"}}}\n',
        'utf8',
      );
      materializeHostConfigPlan(environment, plan);
      expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({
        theme: 'dark',
        mcpServers: {
          operator: { type: 'http', url: 'https://example.test' },
          issues: { type: 'stdio', command: 'node', args: ['issues.js'] },
        },
      });
    } finally {
      environment.cleanup();
    }
  });

  it('rejects unsupported package and non-portable MCP fields', () => {
    expect(
      claudeCodeHarnessAdapter.declarePackage({ logicalId: 'issues', scope: 'project', version: '1.2.3' }).diagnostics,
    ).toMatchObject([{ code: 'UNSUPPORTED_HOST_FEATURE', feature: 'config.package' }]);
    expect(
      claudeCodeHarnessAdapter.planHostConfiguration({
        kind: 'mcp.local',
        scope: 'project',
        server: { name: 'issues', command: ['node', 'issues.js'], cwd: '.neottia/bin' },
      }).diagnostics,
    ).toMatchObject([{ code: 'INVALID_MCP_DECLARATION' }]);
    expect(
      claudeCodeHarnessAdapter.planHostConfiguration({
        kind: 'mcp.remote',
        scope: 'project',
        server: { name: 'docs', url: 'http://example.test/mcp', headers: { Authorization: 'secret' } },
      }).diagnostics,
    ).toMatchObject([{ code: 'INVALID_MCP_DECLARATION' }]);
  });

  it('rejects malformed runtime requests without throwing', () => {
    const calls = [
      () => claudeCodeHarnessAdapter.target({ feature: 'asset.unknown', scope: 'project' } as never),
      () =>
        claudeCodeHarnessAdapter.projectPrompt({
          id: 'plan',
          scope: 'project',
          body: 'Plan.\n',
          metadata: { execution: { subtask: 'yes' } },
        } as never),
      () =>
        claudeCodeHarnessAdapter.projectAgent({
          id: 'reviewer',
          scope: 'project',
          body: 'Review.\n',
          description: 'Review.',
          mode: 'worker',
        } as never),
      () => claudeCodeHarnessAdapter.planHostConfiguration({ kind: 'unknown' } as never),
      () => claudeCodeHarnessAdapter.reloadNotice({ changedFeatures: ['asset.unknown'] } as never),
    ];
    for (const call of calls) {
      expect(call).not.toThrow();
      expect(call().diagnostics).toMatchObject([{ code: 'INVALID_REQUEST' }]);
    }
  });

  it('recommends restart and reports no tested binary version', () => {
    expect(claudeCodeHarnessAdapter.reloadNotice({ changedFeatures: ['asset.prompt'] }).value).toMatchObject({
      hostId: 'claude-code',
      action: 'restart',
      affectedFeatures: ['asset.prompt'],
    });
    expect(claudeCodeHarnessAdapter.reloadNotice({ changedFeatures: [] }).value).toMatchObject({ action: 'none' });
  });
});
