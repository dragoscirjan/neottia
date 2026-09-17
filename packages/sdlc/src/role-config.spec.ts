import { describe, expect, it } from 'vitest';

import {
  SDLC_ROLE_HARNESS_IDS,
  sdlcRoleAssignmentConfigSchema,
  sdlcRoleAssignmentsConfigPatchSchema,
  sdlcRoleAssignmentsConfigSchema,
} from './role-config.js';

describe('SDLC role assignment configuration', () => {
  it('publishes independent strict harness maps with no implicit assignments', () => {
    expect(SDLC_ROLE_HARNESS_IDS).toEqual(['pi', 'opencode']);
    expect(sdlcRoleAssignmentsConfigSchema.parse({})).toEqual({ pi: {}, opencode: {} });
    expect(
      sdlcRoleAssignmentsConfigSchema.parse({
        pi: { planner: { agent: 'current' } },
        opencode: { planner: { agent: 'neottia-planner', model: 'provider/model', thinking: 'high' } },
      }),
    ).toEqual({
      pi: {
        planner: { agent: 'current', required_skills: [], required_tools: [] },
      },
      opencode: {
        planner: {
          agent: 'neottia-planner',
          model: 'provider/model',
          thinking: 'high',
          required_skills: [],
          required_tools: [],
        },
      },
    });
  });

  it('keeps patches default-free so profiles can extend or disable assignments', () => {
    expect(
      sdlcRoleAssignmentsConfigPatchSchema.parse({
        opencode: { planner: { model: 'provider/model' }, researcher: false },
      }),
    ).toEqual({ opencode: { planner: { model: 'provider/model' }, researcher: false } });
  });

  it.each([
    { claude: {} },
    { pi: { unknown: { agent: 'current' } } },
    { pi: { planner: { agent: 'current', permissions: { shell: 'allow' } } } },
    { pi: { planner: { agent: '../planner' } } },
    { pi: { planner: { agent: 'current', model: 'provider/model\nunsafe' } } },
    { pi: { planner: { agent: 'current', model: ' ' } } },
    { pi: { planner: { agent: 'current', model: 'provider/model`unsafe' } } },
    { pi: { planner: { agent: 'current', model: 'provider/model\tunsafe' } } },
    { pi: { planner: { agent: 'current', required_skills: ['planning', 'planning'] } } },
    { pi: { planner: { agent: 'current', required_tools: ['tool with spaces'] } } },
  ])('rejects unknown, permissive, or unsafe configuration %#', (value) => {
    expect(sdlcRoleAssignmentsConfigSchema.safeParse(value).success).toBe(false);
  });

  it('bounds hints and requirement lists', () => {
    expect(sdlcRoleAssignmentConfigSchema.safeParse({ agent: 'current', model: 'x'.repeat(257) }).success).toBe(false);
    expect(
      sdlcRoleAssignmentConfigSchema.safeParse({
        agent: 'current',
        required_tools: Array.from({ length: 33 }, (_, index) => `tool-${index}`),
      }).success,
    ).toBe(false);
  });
});
