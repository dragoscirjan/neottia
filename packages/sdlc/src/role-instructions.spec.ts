import { createConfigRegistry, createResolvedConfigSnapshot, type ConfigShardValues } from '@neottia/config';
import { defineHarnessDeclaration } from '@neottia/harness-adapter';
import { describe, expect, it } from 'vitest';

import { SdlcConfigError } from './compiler-context.js';
import { SDLC_LIFECYCLE } from './lifecycle.js';
import { sdlcRoleAssignmentsConfigContribution } from './role-config.js';
import {
  createConfiguredSdlcRoleInstructions,
  createSdlcRoleAgentRequests,
  createSdlcRoleCompilerContext,
  SDLC_ROLE_DECLARATIONS,
  SDLC_ROLE_MAX_STEPS,
  validateSdlcRoleCompilerContext,
} from './role-instructions.js';
import { claudeCodeHarnessDeclaration } from '../../../extensions/claude-code-adapter/src/index.js';
import { opencodeHarnessDeclaration } from '../../../extensions/opencode-adapter/src/index.js';
import { piHarnessDeclaration } from '../../../extensions/pi-adapter/src/index.js';

const registry = createConfigRegistry([sdlcRoleAssignmentsConfigContribution]);
const REQUIRED_CURRENT_ASSIGNMENTS = Object.freeze({
  planner: { agent: 'current' as const },
  implementer: { agent: 'current' as const },
  verifier: { agent: 'current' as const },
  'release-coordinator': { agent: 'current' as const },
});

/** Creates one role-only snapshot without reading ambient files. */
function snapshot(assignments: ConfigShardValues['sdlc-role-assignments'] = {}) {
  return createResolvedConfigSnapshot(registry, { 'sdlc-role-assignments': assignments });
}

describe('portable SDLC role compilation', () => {
  it('owns lead-role requiredness independently of user configuration', () => {
    expect(
      Object.values(SDLC_ROLE_DECLARATIONS)
        .filter(({ required }) => required)
        .map(({ id }) => id),
    ).toEqual(['planner', 'implementer', 'verifier', 'release-coordinator']);
  });

  it('reports every missing required role before projection', () => {
    let thrown: unknown;
    try {
      createSdlcRoleCompilerContext(snapshot(), 'pi', piHarnessDeclaration, 'project');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SdlcConfigError);
    const problems = (thrown as SdlcConfigError).problems;
    expect(problems.map(({ code }) => code)).toEqual(Array(4).fill('ROLE_ASSIGNMENT_REQUIRED'));
    expect(problems.map(({ path }) => path.join('.'))).toEqual([
      'agents.sdlc.pi.implementer',
      'agents.sdlc.pi.planner',
      'agents.sdlc.pi.release-coordinator',
      'agents.sdlc.pi.verifier',
    ]);
  });

  it('generates a complete checksummed invocation set with optional current-agent fallback', () => {
    const context = createSdlcRoleCompilerContext(
      snapshot({ pi: REQUIRED_CURRENT_ASSIGNMENTS }),
      'pi',
      piHarnessDeclaration,
      'project',
    );
    const instructions = createConfiguredSdlcRoleInstructions(context);

    expect(instructions).toHaveLength(SDLC_LIFECYCLE.reduce((total, command) => total + command.roleSlots.length, 0));
    expect(instructions.every(({ checksum }) => checksum.startsWith('sha256:'))).toBe(true);
    expect(instructions.find(({ role }) => role === 'planner')?.content).toContain(
      'explicitly requires the current agent',
    );
    expect(instructions.find(({ role }) => role === 'researcher')?.content).toContain(
      'No dedicated agent is assigned for this optional role',
    );
    expect(instructions[0]?.content).toContain('Perform this role directly within the current command');
    expect(instructions[0]?.content).toContain('do not delegate it');
    expect(instructions[0]?.content).not.toContain('Use exactly one bounded invocation');
    expect(instructions[0]?.content).toContain('A role result is evidence, not authorization.');
    expect(Object.isFrozen(context.roles)).toBe(true);
  });

  it('rejects named Pi routes rather than inventing native agent support', () => {
    expect(() =>
      createSdlcRoleCompilerContext(
        snapshot({ pi: { ...REQUIRED_CURRENT_ASSIGNMENTS, planner: { agent: 'neottia-planner' } } }),
        'pi',
        piHarnessDeclaration,
        'project',
      ),
    ).toThrowError(
      expect.objectContaining({
        problems: [expect.objectContaining({ code: 'ROLE_ASSIGNMENT_UNSUPPORTED' })],
      }),
    );
  });

  it('projects supported OpenCode metadata and degrades thinking to advisory prose', () => {
    const context = createSdlcRoleCompilerContext(
      snapshot({
        pi: { planner: { agent: 'unused-pi-agent' } },
        opencode: {
          ...REQUIRED_CURRENT_ASSIGNMENTS,
          planner: {
            agent: 'neottia-planner',
            model: 'provider/model',
            thinking: 'high',
            required_skills: ['planning'],
            required_tools: ['issue_read'],
          },
        },
      }),
      'opencode',
      opencodeHarnessDeclaration,
      'project',
    );
    const agents = createSdlcRoleAgentRequests(context);
    const planner = createConfiguredSdlcRoleInstructions(context).find(({ role }) => role === 'planner')!;

    expect(JSON.stringify(context)).not.toContain('unused-pi-agent');
    expect(agents).toHaveLength(1);
    expect(agents[0]?.request).toMatchObject({
      id: 'neottia-planner',
      mode: 'subagent',
      modelHint: 'provider/model',
      steps: SDLC_ROLE_MAX_STEPS,
    });
    expect(agents[0]?.request).not.toHaveProperty('thinkingHint');
    expect(agents[0]?.request).not.toHaveProperty('permissions');
    expect(agents[0]?.request.body).toContain('Accept one bounded handoff');
    expect(agents[0]?.request.body).toContain('do not delegate recursively');
    expect(agents[0]?.request.body).not.toContain('Use exactly one bounded invocation');
    expect(planner.content).toContain('Use exactly one bounded invocation');
    expect(planner.content).toContain('Thinking hint `high` is advisory');
    expect(planner.content).toContain('Required skills: `planning`');
    expect(planner.content).toContain('Required tools: `issue_read`');
  });

  it('projects roles for adapter IDs registered outside the original built-ins', () => {
    const context = createSdlcRoleCompilerContext(
      snapshot({
        'claude-code': {
          ...REQUIRED_CURRENT_ASSIGNMENTS,
          verifier: {
            agent: 'neottia-verifier',
            model: 'sonnet',
            thinking: 'high',
          },
        },
      }),
      'claude-code',
      claudeCodeHarnessDeclaration,
      'project',
    );

    expect(context.harnessId).toBe('claude-code');
    expect(createSdlcRoleAgentRequests(context)).toMatchObject([
      {
        role: 'verifier',
        request: {
          id: 'neottia-verifier',
          modelHint: 'sonnet',
          thinkingHint: 'high',
          steps: SDLC_ROLE_MAX_STEPS,
        },
      },
    ]);
  });

  it('rejects named routes outside the declared native-agent scopes', () => {
    const globalOnlyDeclaration = defineHarnessDeclaration({
      ...opencodeHarnessDeclaration,
      features: {
        ...opencodeHarnessDeclaration.features,
        'asset.agent': { ...opencodeHarnessDeclaration.features['asset.agent'], scopes: ['global'] },
        'agent.subagent': { ...opencodeHarnessDeclaration.features['agent.subagent'], scopes: ['global'] },
      },
    });
    const configured = snapshot({
      opencode: {
        ...REQUIRED_CURRENT_ASSIGNMENTS,
        planner: { agent: 'neottia-planner' },
      },
    });

    expect(() => createSdlcRoleCompilerContext(configured, 'opencode', globalOnlyDeclaration, 'project')).toThrowError(
      expect.objectContaining({
        problems: [expect.objectContaining({ code: 'ROLE_ASSIGNMENT_UNSUPPORTED' })],
      }),
    );

    const context = createSdlcRoleCompilerContext(configured, 'opencode', globalOnlyDeclaration, 'global');
    expect(createSdlcRoleAgentRequests(context)[0]?.request.scope).toBe('global');
  });

  it('emits optional agent metadata only in its declared scopes', () => {
    const globalMetadataDeclaration = defineHarnessDeclaration({
      ...opencodeHarnessDeclaration,
      features: {
        ...opencodeHarnessDeclaration.features,
        'agent.model': { ...opencodeHarnessDeclaration.features['agent.model'], scopes: ['global'] },
        'agent.steps': { ...opencodeHarnessDeclaration.features['agent.steps'], scopes: ['global'] },
      },
    });
    const configured = snapshot({
      opencode: {
        ...REQUIRED_CURRENT_ASSIGNMENTS,
        planner: { agent: 'neottia-planner', model: 'provider/model' },
      },
    });

    const projectContext = createSdlcRoleCompilerContext(configured, 'opencode', globalMetadataDeclaration, 'project');
    const projectAgent = createSdlcRoleAgentRequests(projectContext)[0]!.request;
    expect(projectAgent).not.toHaveProperty('modelHint');
    expect(projectAgent).not.toHaveProperty('steps');

    const globalContext = createSdlcRoleCompilerContext(configured, 'opencode', globalMetadataDeclaration, 'global');
    const globalAgent = createSdlcRoleAgentRequests(globalContext)[0]!.request;
    expect(globalAgent.modelHint).toBe('provider/model');
    expect(globalAgent.steps).toBe(SDLC_ROLE_MAX_STEPS);
  });

  it('rejects duplicate native agent targets and tampered requiredness', () => {
    expect(() =>
      createSdlcRoleCompilerContext(
        snapshot({
          opencode: {
            planner: { agent: 'shared-agent' },
            implementer: { agent: 'shared-agent' },
            verifier: { agent: 'verifier' },
            'release-coordinator': { agent: 'release-coordinator' },
          },
        }),
        'opencode',
        opencodeHarnessDeclaration,
        'project',
      ),
    ).toThrowError(
      expect.objectContaining({
        problems: [expect.objectContaining({ code: 'ROLE_AGENT_DUPLICATED' })],
      }),
    );

    const context = createSdlcRoleCompilerContext(
      snapshot({ pi: REQUIRED_CURRENT_ASSIGNMENTS }),
      'pi',
      piHarnessDeclaration,
      'project',
    );
    const tampered = structuredClone(context);
    tampered.roles[0]!.required = false;
    expect(() => validateSdlcRoleCompilerContext(tampered)).toThrow('not canonical');
  });
});
