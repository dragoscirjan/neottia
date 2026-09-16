import type { TemplateLayer } from '@neottia/distribution';

/** Version of the canonical lifecycle semantics and packaged templates. */
export const SDLC_LIFECYCLE_VERSION = '1.0.0';

/** Public commands exposed by every compiled harness. */
export const SDLC_COMMAND_IDS = Object.freeze(['plan', 'build', 'verify', 'release', 'continue', 'refresh'] as const);

/** Stable identifier for one canonical command. */
export type SdlcCommandId = (typeof SDLC_COMMAND_IDS)[number];

/** Portable role vocabulary consumed later by the role compiler in #118. */
export const SDLC_ROLE_IDS = Object.freeze([
  'planner',
  'researcher',
  'implementer',
  'reviewer',
  'verifier',
  'release-coordinator',
  'documentation-writer',
] as const);

/** Stable role invocation identity independent of harness agent names. */
export type SdlcRoleId = (typeof SDLC_ROLE_IDS)[number];

/** Slots replaced with compile-time instructions before adapter projection. */
export const SDLC_TEMPLATE_TOKENS = Object.freeze({
  issues: '{{neottia.instructions.issues}}',
  documents: '{{neottia.instructions.documents}}',
  sourceControlLocal: '{{neottia.instructions.source-control.local}}',
  sourceControlRemote: '{{neottia.instructions.source-control.remote}}',
  role: '{{neottia.instructions.role}}',
});

/** Host-neutral lifecycle semantics shared by every adapter output. */
export interface SdlcLifecycleCommand {
  readonly id: SdlcCommandId;
  readonly templateId: string;
  readonly description: string;
  readonly roleSlots: readonly SdlcRoleId[];
  readonly allowedNext: readonly SdlcCommandId[];
  readonly approvalPoints: readonly string[];
  readonly stopConditions: readonly string[];
  readonly enforcement: 'guidance-only';
}

/** Canonical lifecycle graph; hosts may change syntax and paths, not semantics. */
export const SDLC_LIFECYCLE = Object.freeze([
  command(
    'plan',
    ['planner', 'researcher'],
    ['build', 'refresh'],
    ['Obtain explicit approval for the proposed scope before Build.'],
    ['Requirements, ownership, dependencies, or acceptance evidence remain ambiguous.'],
  ),
  command(
    'build',
    ['implementer', 'documentation-writer'],
    ['verify', 'continue', 'refresh'],
    ['Use only the scope approved by Plan; request approval before expanding it.'],
    ['The approved plan is missing, stale, blocked, or contradicted by repository evidence.'],
  ),
  command(
    'verify',
    ['reviewer', 'verifier'],
    ['build', 'release', 'continue', 'refresh'],
    ['Release requires successful required checks and an explicit release decision.'],
    ['Required checks fail, evidence is incomplete, or unreviewed changes are present.'],
  ),
  command(
    'release',
    ['release-coordinator', 'documentation-writer'],
    ['continue', 'refresh'],
    ['Ask before merge, publication, deployment, tagging, or another irreversible action.'],
    ['Verification is unsuccessful, approval is absent, or the release target changed.'],
  ),
  command(
    'continue',
    ['planner'],
    ['plan', 'build', 'verify', 'release', 'refresh'],
    ['Recommend exactly one supported next command, explain the evidence, and stop without invoking it.'],
    ['The previous phase, approval state, or current ownership cannot be established.'],
  ),
  command(
    'refresh',
    ['researcher'],
    ['continue', 'plan'],
    ['Report changed assumptions before resuming work.'],
    ['Refreshing context would require mutation or would discard unresolved evidence.'],
  ),
] satisfies readonly SdlcLifecycleCommand[]);

/** Creates one immutable lifecycle definition. */
function command(
  id: SdlcCommandId,
  roleSlots: readonly SdlcRoleId[],
  allowedNext: readonly SdlcCommandId[],
  approvalPoints: readonly string[],
  stopConditions: readonly string[],
): SdlcLifecycleCommand {
  return Object.freeze({
    id,
    templateId: `neottia.sdlc.command.${id}`,
    description: `${title(id)} the current SDLC work`,
    roleSlots: Object.freeze([...roleSlots]),
    allowedNext: Object.freeze([...allowedNext]),
    approvalPoints: Object.freeze([...approvalPoints]),
    stopConditions: Object.freeze([...stopConditions]),
    enforcement: 'guidance-only' as const,
  });
}

/** Renders one complete provider-neutral template with stable instruction slots. */
function templateContent(definition: SdlcLifecycleCommand): string {
  const sequence = sequences[definition.id].map((step, index) => `${index + 1}. ${step}`).join('\n');
  return `# ${title(definition.id)}\n\n## Purpose\n\n${purposes[definition.id]}\n\n## Required sequence\n\n${sequence}\n\n## Approval points\n\n${bullets(definition.approvalPoints)}\n\n## Stop conditions\n\n${bullets(definition.stopConditions)}\n\n## Compiled Issues instructions\n\n${SDLC_TEMPLATE_TOKENS.issues}\n\n## Compiled Documents instructions\n\n${SDLC_TEMPLATE_TOKENS.documents}\n\n## Compiled local source-control instructions\n\n${SDLC_TEMPLATE_TOKENS.sourceControlLocal}\n\n## Compiled remote source-control instructions\n\n${SDLC_TEMPLATE_TOKENS.sourceControlRemote}\n\n## Role invocation\n\n${SDLC_TEMPLATE_TOKENS.role}\n\n## Permission boundary\n\nThese lifecycle instructions are guidance. They do not grant host permissions. Honor host-enforced restrictions and request approval where this command requires it.\n`;
}

/** Stable command-specific purpose text. */
const purposes: Readonly<Record<SdlcCommandId, string>> = Object.freeze({
  plan: 'Turn the request and repository evidence into a bounded implementation plan.',
  build: 'Implement only the approved plan and preserve reviewable evidence.',
  verify: 'Evaluate the implementation against requirements and required checks.',
  release: 'Prepare an approved, verified change for its explicitly selected release action.',
  continue: 'Recommend one next public command from durable lifecycle evidence without executing it.',
  refresh: 'Reload configuration, repository state, and tracked work before deciding what comes next.',
});

/** Stable command-specific sequences without provider syntax. */
const sequences: Readonly<Record<SdlcCommandId, readonly string[]>> = Object.freeze({
  plan: Object.freeze([
    'Read the request, tracked work, relevant documents, configuration, and repository state.',
    'Identify requirements, dependencies, risks, affected surfaces, and validation evidence.',
    'Record the proposed work and stop for the required scope approval.',
  ]),
  build: Object.freeze([
    'Confirm the approved plan and current ownership before mutation.',
    'Implement the smallest coherent change and record material decisions.',
    'Hand the resulting change and evidence to Verify.',
  ]),
  verify: Object.freeze([
    'Compare the change with every requirement and stop condition.',
    'Run the required checks and inspect user-visible and operational behavior.',
    'Return failures to Build or present successful evidence for the release decision.',
  ]),
  release: Object.freeze([
    'Confirm verification evidence, release scope, and the requested release action.',
    'Prepare release metadata and execute only explicitly approved irreversible actions.',
    'Record the released result and remaining follow-up work.',
  ]),
  continue: Object.freeze([
    'Read durable tracked work, documents, configuration, and repository state.',
    'Determine the last completed phase and whether its evidence is still current.',
    'Recommend exactly one supported next public command with its evidence, then stop without invoking it.',
  ]),
  refresh: Object.freeze([
    'Reload resolved configuration and current provider-backed records.',
    'Inspect repository and source-control changes since the previous evidence.',
    'Report changed assumptions and select Continue or a new Plan without mutating work.',
  ]),
});

/** Provider-neutral packaged templates resolved through distribution precedence. */
export const PACKAGED_LIFECYCLE_TEMPLATES: TemplateLayer = Object.freeze({
  tier: 'packaged',
  sourceId: '@neottia/sdlc',
  version: SDLC_LIFECYCLE_VERSION,
  files: Object.freeze(
    SDLC_LIFECYCLE.map((definition) =>
      Object.freeze({ id: definition.templateId, content: templateContent(definition) }),
    ),
  ),
});

/** Formats immutable policy lines as Markdown bullets. */
function bullets(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join('\n');
}

/** Formats a command ID for user-visible headings. */
function title(id: SdlcCommandId): string {
  return `${id[0]!.toUpperCase()}${id.slice(1)}`;
}
