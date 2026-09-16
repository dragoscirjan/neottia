/** Version of the canonical lifecycle semantics and packaged templates. */
export const SDLC_LIFECYCLE_VERSION = '1.0.0';

/** Public commands exposed by every compiled harness. */
export const SDLC_COMMAND_IDS = Object.freeze(['plan', 'build', 'verify', 'release', 'continue', 'refresh'] as const);

/** Internal packaged lifecycle content loaded outside the pure compiler. */
export const SDLC_CONTENT_TEMPLATE_ID = 'neottia.sdlc.lifecycle';

/** Internal packaged Twig layout shared by the six command templates. */
export const SDLC_LAYOUT_TEMPLATE_ID = 'neottia.sdlc.layout';

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

/** Host-neutral lifecycle graph shared by every adapter output. */
export interface SdlcLifecycleCommand {
  readonly id: SdlcCommandId;
  readonly templateId: string;
  readonly roleSlots: readonly SdlcRoleId[];
  readonly allowedNext: readonly SdlcCommandId[];
  readonly enforcement: 'guidance-only';
}

/** Canonical lifecycle graph; hosts may change syntax and paths, not semantics. */
export const SDLC_LIFECYCLE = Object.freeze([
  command('plan', ['planner', 'researcher'], ['build', 'refresh']),
  command('build', ['implementer', 'documentation-writer'], ['verify', 'continue', 'refresh']),
  command('verify', ['reviewer', 'verifier'], ['build', 'release', 'continue', 'refresh']),
  command('release', ['release-coordinator', 'documentation-writer'], ['continue', 'refresh']),
  command('continue', ['planner'], ['plan', 'build', 'verify', 'release', 'refresh']),
  command('refresh', ['researcher'], ['continue', 'plan']),
] satisfies readonly SdlcLifecycleCommand[]);

/** Creates one immutable lifecycle graph node. */
function command(
  id: SdlcCommandId,
  roleSlots: readonly SdlcRoleId[],
  allowedNext: readonly SdlcCommandId[],
): SdlcLifecycleCommand {
  return Object.freeze({
    id,
    templateId: `neottia.sdlc.command.${id}`,
    roleSlots: Object.freeze([...roleSlots]),
    allowedNext: Object.freeze([...allowedNext]),
    enforcement: 'guidance-only' as const,
  });
}
