import type { ResolvedConfigSnapshot } from '@neottia/config';
import { canonicalJson } from '@neottia/distribution';
import type { AgentProjectionRequest, HarnessDeclaration, HarnessScope, HostFeature } from '@neottia/harness-adapter';
import { z } from 'zod';

import { SdlcConfigError, type SdlcConfigProblem } from './compiler-context.js';
import { createSdlcRoleInstruction, type SdlcRoleInstruction } from './instructions.js';
import { SDLC_LIFECYCLE, SDLC_ROLE_IDS, type SdlcRoleId } from './lifecycle.js';
import {
  SDLC_ROLE_HARNESS_IDS,
  sdlcRoleAssignmentConfigSchema,
  sdlcRoleAssignmentsConfigContribution,
  type SdlcRoleAssignmentConfig,
  type SdlcRoleHarnessId,
} from './role-config.js';

/** Version of the package-owned role and handoff contracts. */
export const SDLC_ROLE_INSTRUCTION_VERSION = '1.0.0';
/** Maximum host steps requested for one native role invocation. */
export const SDLC_ROLE_MAX_STEPS = 24;
/** Maximum evidence entries requested from one role invocation. */
export const SDLC_ROLE_MAX_EVIDENCE = 20;
/** Maximum result bytes requested from one role invocation. */
export const SDLC_ROLE_MAX_RESULT_BYTES = 8192;

/** Package-owned role declaration that assignments cannot weaken. */
export interface SdlcRoleDeclaration {
  readonly id: SdlcRoleId;
  readonly required: boolean;
  readonly description: string;
  readonly objective: string;
}

/** Canonical requiredness and duties for every portable role. */
export const SDLC_ROLE_DECLARATIONS: Readonly<Record<SdlcRoleId, SdlcRoleDeclaration>> = Object.freeze({
  planner: role(
    'planner',
    true,
    'Plan approved SDLC work',
    'Define scope, dependencies, acceptance evidence, and approval boundaries.',
  ),
  researcher: role(
    'researcher',
    false,
    'Research unresolved SDLC questions',
    'Resolve bounded unknowns with source-backed findings and explicit uncertainty.',
  ),
  implementer: role(
    'implementer',
    true,
    'Implement approved SDLC work',
    'Change only the approved scope and preserve reviewable implementation evidence.',
  ),
  reviewer: role(
    'reviewer',
    false,
    'Review SDLC work independently',
    'Inspect the result against requirements and report findings without silently mutating it.',
  ),
  verifier: role(
    'verifier',
    true,
    'Verify SDLC work',
    'Run required checks and return a supported verdict with exact failure or success evidence.',
  ),
  'release-coordinator': role(
    'release-coordinator',
    true,
    'Coordinate an approved release',
    'Prepare release evidence while keeping merge, publication, tagging, and deployment separately authorized.',
  ),
  'documentation-writer': role(
    'documentation-writer',
    false,
    'Document user-visible behavior',
    'Keep user documentation aligned with verified behavior and avoid undocumented implementation claims.',
  ),
});

/** Adapter features that affect portable role projection. */
export interface SdlcRoleHostSupport {
  readonly agentAsset: boolean;
  readonly subagent: boolean;
  readonly model: boolean;
  readonly steps: boolean;
  readonly thinking: boolean;
}

/** One selected assignment detached from unselected harness configuration. */
export interface SdlcSelectedRoleAssignment {
  readonly role: SdlcRoleId;
  readonly required: boolean;
  readonly assignment?: SdlcRoleAssignmentConfig;
}

/** Selected-only role context serialized into compiler input. */
export interface SdlcRoleCompilerContext {
  readonly harnessId: SdlcRoleHarnessId;
  readonly hostSupport: SdlcRoleHostSupport;
  readonly roles: readonly SdlcSelectedRoleAssignment[];
}

/** Native role asset request retained with its canonical role identity. */
export interface SdlcProjectedRoleAgent {
  readonly role: SdlcRoleId;
  readonly assignment: SdlcRoleAssignmentConfig;
  readonly request: AgentProjectionRequest;
}

const roleHostSupportSchema = z
  .object({
    agentAsset: z.boolean(),
    subagent: z.boolean(),
    model: z.boolean(),
    steps: z.boolean(),
    thinking: z.boolean(),
  })
  .strict();

/** Runtime schema used to reject tampered selected role context. */
export const sdlcRoleCompilerContextSchema = z
  .object({
    harnessId: z.enum(SDLC_ROLE_HARNESS_IDS),
    hostSupport: roleHostSupportSchema,
    roles: z.array(
      z
        .object({
          role: z.enum(SDLC_ROLE_IDS),
          required: z.boolean(),
          assignment: sdlcRoleAssignmentConfigSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

/** Builds selected-only immutable role context and reports missing required assignments. */
export function createSdlcRoleCompilerContext(
  snapshot: ResolvedConfigSnapshot,
  harnessId: string,
  declaration: HarnessDeclaration,
): SdlcRoleCompilerContext {
  if (declaration.id !== harnessId) throw new TypeError('Role compiler harness declaration does not match its ID.');
  if (!isSdlcRoleHarnessId(harnessId)) {
    throw new SdlcConfigError([
      {
        code: 'ROLE_HARNESS_UNSUPPORTED',
        path: ['agents', 'sdlc'],
        message: 'The selected harness has no built-in SDLC role assignment schema.',
      },
    ]);
  }

  const support = roleHostSupport(declaration);
  const configured = snapshot.get(sdlcRoleAssignmentsConfigContribution)[harnessId];
  const problems: SdlcConfigProblem[] = [];
  const agentRoles = new Map<string, SdlcRoleId>();
  const roles = SDLC_ROLE_IDS.map((roleId): SdlcSelectedRoleAssignment => {
    const roleDefinition = SDLC_ROLE_DECLARATIONS[roleId];
    const value = configured[roleId];
    const assignment = value === false || value === undefined ? undefined : freezeAssignment(value);
    if (assignment === undefined && roleDefinition.required) {
      problems.push({
        code: 'ROLE_ASSIGNMENT_REQUIRED',
        path: ['agents', 'sdlc', harnessId, roleId],
        message: 'A required SDLC role needs an explicit selected-harness assignment.',
      });
    }
    if (assignment !== undefined && assignment.agent !== 'current') {
      if (!supportsNamedAgent(support)) {
        problems.push({
          code: 'ROLE_ASSIGNMENT_UNSUPPORTED',
          path: ['agents', 'sdlc', harnessId, roleId, 'agent'],
          message: 'The selected harness cannot project this named SDLC role assignment.',
        });
      }
      const previous = agentRoles.get(assignment.agent);
      if (previous !== undefined) {
        problems.push({
          code: 'ROLE_AGENT_DUPLICATED',
          path: ['agents', 'sdlc', harnessId, roleId, 'agent'],
          message: 'Named SDLC role agents must be unique within one harness assignment map.',
        });
      } else {
        agentRoles.set(assignment.agent, roleId);
      }
    }
    return Object.freeze({ role: roleId, required: roleDefinition.required, ...(assignment ? { assignment } : {}) });
  });
  if (problems.length > 0) throw new SdlcConfigError(problems);
  const context = Object.freeze({ harnessId, hostSupport: support, roles: Object.freeze(roles) });
  validateSdlcRoleCompilerContext(context);
  return context;
}

/** Validates canonical selected role context decoded from compiler input. */
export function validateSdlcRoleCompilerContext(context: SdlcRoleCompilerContext): void {
  if (!sdlcRoleCompilerContextSchema.safeParse(context).success) {
    throw new TypeError('SDLC role compiler context schema is invalid.');
  }
  if (context.roles.length !== SDLC_ROLE_IDS.length) throw new TypeError('SDLC role context is incomplete.');
  const namedAgents = new Set<string>();
  for (const [index, roleId] of SDLC_ROLE_IDS.entries()) {
    const selected = context.roles[index];
    const declaration = SDLC_ROLE_DECLARATIONS[roleId];
    if (selected?.role !== roleId || selected.required !== declaration.required) {
      throw new TypeError('SDLC role context is not canonical.');
    }
    if (selected.assignment === undefined && declaration.required) {
      throw new TypeError('SDLC role context is missing a required assignment.');
    }
    if (selected.assignment?.agent !== undefined && selected.assignment.agent !== 'current') {
      if (!supportsNamedAgent(context.hostSupport)) {
        throw new TypeError('SDLC role context contains an unsupported named assignment.');
      }
      if (namedAgents.has(selected.assignment.agent))
        throw new TypeError('SDLC role context duplicates a named agent.');
      namedAgents.add(selected.assignment.agent);
    }
  }
}

/** Generates one complete checksummed fragment for every lifecycle invocation point. */
export function createConfiguredSdlcRoleInstructions(context: SdlcRoleCompilerContext): readonly SdlcRoleInstruction[] {
  validateSdlcRoleCompilerContext(context);
  return Object.freeze(
    SDLC_LIFECYCLE.flatMap((command) =>
      command.roleSlots.map((roleId) => {
        const selected = selectedRole(context, roleId);
        return createSdlcRoleInstruction({
          id: `neottia.role.${command.id}.${roleId}`,
          command: command.id,
          role: roleId,
          version: SDLC_ROLE_INSTRUCTION_VERSION,
          content: roleInstructionContent(context, selected),
        });
      }),
    ),
  );
}

/** Creates native subagent requests only for routes the selected host can represent. */
export function createSdlcRoleAgentRequests(
  context: SdlcRoleCompilerContext,
  scope: HarnessScope,
): readonly SdlcProjectedRoleAgent[] {
  validateSdlcRoleCompilerContext(context);
  return Object.freeze(
    context.roles.flatMap((selected): SdlcProjectedRoleAgent[] => {
      const assignment = selected.assignment;
      if (assignment === undefined || assignment.agent === 'current') return [];
      const declaration = SDLC_ROLE_DECLARATIONS[selected.role];
      const request: AgentProjectionRequest = Object.freeze({
        id: assignment.agent,
        scope,
        body: roleAgentBody(selected, context.hostSupport),
        description: declaration.description,
        mode: 'subagent' as const,
        ...(assignment.model === undefined || !context.hostSupport.model ? {} : { modelHint: assignment.model }),
        ...(assignment.thinking === undefined || !context.hostSupport.thinking
          ? {}
          : { thinkingHint: assignment.thinking }),
        ...(context.hostSupport.steps ? { steps: SDLC_ROLE_MAX_STEPS } : {}),
      });
      return [{ role: selected.role, assignment, request: Object.freeze(request) }];
    }),
  );
}

/** Returns configuration paths whose selected values affect role compilation. */
export function sdlcRoleConfigurationPaths(context: SdlcRoleCompilerContext): readonly (readonly string[])[] {
  const paths: string[][] = [];
  for (const selected of context.roles) {
    const assignment = selected.assignment;
    if (assignment === undefined) continue;
    const prefix = ['agents', 'sdlc', context.harnessId, selected.role];
    paths.push([...prefix, 'agent']);
    if (assignment.model !== undefined) paths.push([...prefix, 'model']);
    if (assignment.thinking !== undefined) paths.push([...prefix, 'thinking']);
    if (assignment.required_skills.length > 0) paths.push([...prefix, 'required_skills']);
    if (assignment.required_tools.length > 0) paths.push([...prefix, 'required_tools']);
  }
  return Object.freeze(paths.map((path) => Object.freeze(path)));
}

/** Confirms compiler input captured the same role features as the projection adapter. */
export function validateSdlcRoleHostDeclaration(
  context: SdlcRoleCompilerContext,
  declaration: HarnessDeclaration,
): void {
  if (
    declaration.id !== context.harnessId ||
    canonicalJson(roleHostSupport(declaration)) !== canonicalJson(context.hostSupport)
  ) {
    throw new TypeError('SDLC role host support does not match the selected adapter declaration.');
  }
}

/** Converts the relevant #113 declaration features into deterministic booleans. */
export function roleHostSupport(declaration: HarnessDeclaration): SdlcRoleHostSupport {
  const supported = (feature: HostFeature): boolean => declaration.features[feature].status === 'supported';
  return Object.freeze({
    agentAsset: supported('asset.agent'),
    subagent: supported('agent.subagent'),
    model: supported('agent.model'),
    steps: supported('agent.steps'),
    thinking: supported('agent.thinking'),
  });
}

/** Creates one immutable declaration without host-specific policy. */
function role(id: SdlcRoleId, required: boolean, description: string, objective: string): SdlcRoleDeclaration {
  return Object.freeze({ id, required, description, objective });
}

/** Returns one canonical selected role entry. */
function selectedRole(context: SdlcRoleCompilerContext, roleId: SdlcRoleId): SdlcSelectedRoleAssignment {
  return context.roles.find((candidate) => candidate.role === roleId)!;
}

/** Renders host-aware routing around the immutable role contract. */
function roleInstructionContent(context: SdlcRoleCompilerContext, selected: SdlcSelectedRoleAssignment): string {
  const assignment = selected.assignment;
  const lines = [`Portable role: ${selected.role}.`, `Objective: ${SDLC_ROLE_DECLARATIONS[selected.role].objective}`];
  if (assignment === undefined) {
    lines.push(
      'No dedicated agent is assigned for this optional role. The current agent must perform the role; the role duties are not skipped.',
    );
  } else if (assignment.agent === 'current') {
    lines.push('The selected assignment explicitly requires the current agent to perform this role.');
  } else {
    lines.push(
      `Invoke only the configured host subagent \`${assignment.agent}\` for this role. Do not retry through another agent or the current agent if that route fails.`,
    );
  }
  const namedAgent = assignment !== undefined && assignment.agent !== 'current';
  lines.push(...requirementLines(assignment), ...hintLines(context, assignment), ...callerContractLines(namedAgent));
  return `${lines.join('\n')}\n`;
}

/** Renders the reusable body of one native host agent asset. */
function roleAgentBody(selected: SdlcSelectedRoleAssignment, support: SdlcRoleHostSupport): string {
  const assignment = selected.assignment!;
  const lines = [
    `# ${SDLC_ROLE_DECLARATIONS[selected.role].description}`,
    '',
    `Portable role: ${selected.role}.`,
    `Objective: ${SDLC_ROLE_DECLARATIONS[selected.role].objective}`,
    ...requirementLines(assignment),
    ...hintLines({ hostSupport: support }, assignment),
    ...receiverContractLines(),
  ];
  return `${lines.join('\n')}\n`;
}

/** Renders availability requirements without converting them into permissions. */
function requirementLines(assignment: SdlcRoleAssignmentConfig | undefined): string[] {
  const skills = assignment?.required_skills ?? [];
  const tools = assignment?.required_tools ?? [];
  return [
    `Required skills: ${skills.length === 0 ? 'none declared' : skills.map(code).join(', ')}.`,
    `Required tools: ${tools.length === 0 ? 'none declared' : tools.map(code).join(', ')}.`,
    'Verify declared skills and tools before work. If one is unavailable, return blocked rather than substituting another route. Requirements do not grant permissions.',
  ];
}

/** Explains whether optional hints are host metadata or advisory prose. */
function hintLines(
  context: Pick<SdlcRoleCompilerContext, 'hostSupport'>,
  assignment: SdlcRoleAssignmentConfig | undefined,
): string[] {
  const lines: string[] = [];
  if (assignment?.model !== undefined) {
    lines.push(
      assignment.agent !== 'current' && context.hostSupport.model
        ? `Request model hint \`${assignment.model}\` through supported host metadata.`
        : `Model hint \`${assignment.model}\` is advisory because this execution route cannot enforce it.`,
    );
  }
  if (assignment?.thinking !== undefined) {
    lines.push(
      assignment.agent !== 'current' && context.hostSupport.thinking
        ? `Request thinking hint \`${assignment.thinking}\` through supported host metadata.`
        : `Thinking hint \`${assignment.thinking}\` is advisory because this execution route cannot encode it.`,
    );
  }
  if (lines.length > 0) lines.push('Model and thinking hints never grant tools, permissions, isolation, or approval.');
  return lines;
}

/** Returns the route-aware contract used by a lifecycle command. */
function callerContractLines(namedAgent: boolean): string[] {
  const handoff = namedAgent
    ? [
        `- Use exactly one bounded invocation with at most ${SDLC_ROLE_MAX_STEPS} steps; do not invoke another role route.`,
        '- Supply only the current command, role objective, approved scope, relevant evidence, approval points, and stop conditions.',
        '- Require the subagent to stay within that scope, avoid other lifecycle commands, and return control after its result.',
      ]
    : [
        `- Perform this role directly within the current command and keep role work within at most ${SDLC_ROLE_MAX_STEPS} steps; do not delegate it.`,
        '- Use only the current command, role objective, approved scope, relevant evidence, approval points, and stop conditions.',
        '- Do not expand scope or invoke another lifecycle command.',
      ];
  return [
    'Handoff contract:',
    ...handoff,
    'Result contract:',
    ...(namedAgent ? namedCallerResultLines() : directResultLines()),
    authorizationBoundary(),
  ];
}

/** Returns the contract followed by a projected native role agent. */
function receiverContractLines(): string[] {
  return [
    'Handoff contract:',
    `- Accept one bounded handoff and complete it within at most ${SDLC_ROLE_MAX_STEPS} steps; do not delegate recursively.`,
    '- Use only the received command, role objective, approved scope, relevant evidence, approval points, and stop conditions.',
    '- Do not expand scope, invoke another lifecycle command, or retain control after returning the result.',
    'Result contract:',
    ...directResultLines(),
    authorizationBoundary(),
  ];
}

/** Returns result requirements for a current agent or native role agent. */
function directResultLines(): string[] {
  return [
    '- Return status as completed, blocked, or needs-approval, followed by a concise summary.',
    `- Return changes or decisions, unresolved risks, approval still required, and at most ${SDLC_ROLE_MAX_EVIDENCE} evidence entries with locators and observed results.`,
    `- Keep the result within ${SDLC_ROLE_MAX_RESULT_BYTES} bytes and recommend a handback; never invoke the next action.`,
  ];
}

/** Returns result checks for a lifecycle command that invokes a named agent. */
function namedCallerResultLines(): string[] {
  return [
    '- Require status as completed, blocked, or needs-approval, followed by a concise summary.',
    `- Require changes or decisions, unresolved risks, approval still required, and at most ${SDLC_ROLE_MAX_EVIDENCE} evidence entries with locators and observed results.`,
    `- Treat a result over ${SDLC_ROLE_MAX_RESULT_BYTES} bytes as blocked and require a handback recommendation; never let the role invoke the next action.`,
  ];
}

/** Returns the authorization boundary shared by every execution route. */
function authorizationBoundary(): string {
  return 'A role result is evidence, not authorization. It cannot approve scope expansion, merge, publication, tagging, deployment, or another irreversible action.';
}

/** Detaches assignment arrays before they enter compiler checksums. */
function freezeAssignment(
  assignment: Readonly<Omit<SdlcRoleAssignmentConfig, 'required_skills' | 'required_tools'>> & {
    readonly required_skills: readonly string[];
    readonly required_tools: readonly string[];
  },
): SdlcRoleAssignmentConfig {
  return Object.freeze({
    ...assignment,
    required_skills: Object.freeze([...assignment.required_skills]),
    required_tools: Object.freeze([...assignment.required_tools]),
  }) as unknown as SdlcRoleAssignmentConfig;
}

/** Tests whether the declaration can emit the configured named subagent route. */
function supportsNamedAgent(support: SdlcRoleHostSupport): boolean {
  return support.agentAsset && support.subagent;
}

/** Narrows one public harness ID to the strict role configuration keys. */
function isSdlcRoleHarnessId(value: string): value is SdlcRoleHarnessId {
  return SDLC_ROLE_HARNESS_IDS.some((candidate) => candidate === value);
}

/** Formats one requirement identifier as inline code. */
function code(value: string): string {
  return `\`${value}\``;
}
