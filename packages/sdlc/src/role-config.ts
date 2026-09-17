import { defineConfigContribution } from '@neottia/config';
import { HARNESS_ASSET_ID_PATTERN } from '@neottia/harness-adapter';
import { z } from 'zod';

import { SDLC_ROLE_IDS } from './lifecycle.js';

/** Harnesses with built-in role-assignment projections. */
export const SDLC_ROLE_HARNESS_IDS = Object.freeze(['pi', 'opencode'] as const);

/** Stable harness identifier accepted by the role compiler. */
export type SdlcRoleHarnessId = (typeof SDLC_ROLE_HARNESS_IDS)[number];

const MAX_HINT_LENGTH = 256;
const MAX_REQUIREMENTS = 32;
const MAX_REQUIREMENT_ID_LENGTH = 128;
const modelHintSchema = z
  .string()
  .min(1)
  .max(MAX_HINT_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const skillIdSchema = z.string().max(64).regex(HARNESS_ASSET_ID_PATTERN);
const toolIdSchema = z
  .string()
  .min(1)
  .max(MAX_REQUIREMENT_ID_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);

/** Creates a bounded unique requirement list without changing caller order. */
function requirementList<T extends z.ZodType<string>>(item: T) {
  return z
    .array(item)
    .max(MAX_REQUIREMENTS)
    .refine((values) => new Set(values).size === values.length, 'Requirement identifiers must be unique.');
}

/** Complete strict assignment for one canonical role on one harness. */
export const sdlcRoleAssignmentConfigSchema = z
  .object({
    agent: z.union([z.literal('current'), skillIdSchema]),
    model: modelHintSchema.optional(),
    thinking: z.enum(['low', 'medium', 'high']).optional(),
    required_skills: requirementList(skillIdSchema).default([]),
    required_tools: requirementList(toolIdSchema).default([]),
  })
  .strict();

/** Default-free role assignment accepted in file and runtime patches. */
export const sdlcRoleAssignmentConfigPatchSchema = z
  .object({
    agent: z.union([z.literal('current'), skillIdSchema]).optional(),
    model: modelHintSchema.optional(),
    thinking: z.enum(['low', 'medium', 'high']).optional(),
    required_skills: requirementList(skillIdSchema).optional(),
    required_tools: requirementList(toolIdSchema).optional(),
  })
  .strict();

const disabledOrAssignmentSchema = z.union([z.literal(false), sdlcRoleAssignmentConfigSchema]);
const disabledOrAssignmentPatchSchema = z.union([z.literal(false), sdlcRoleAssignmentConfigPatchSchema]);
const harnessAssignmentsShape = Object.fromEntries(
  SDLC_ROLE_IDS.map((role) => [role, disabledOrAssignmentSchema.optional()]),
) as Record<(typeof SDLC_ROLE_IDS)[number], z.ZodOptional<typeof disabledOrAssignmentSchema>>;
const harnessAssignmentPatchShape = Object.fromEntries(
  SDLC_ROLE_IDS.map((role) => [role, disabledOrAssignmentPatchSchema.optional()]),
) as Record<(typeof SDLC_ROLE_IDS)[number], z.ZodOptional<typeof disabledOrAssignmentPatchSchema>>;

/** Complete strict assignment map for one supported harness. */
export const sdlcHarnessRoleAssignmentsSchema = z.object(harnessAssignmentsShape).strict();

/** Default-free assignment map for one supported harness. */
export const sdlcHarnessRoleAssignmentsPatchSchema = z.object(harnessAssignmentPatchShape).strict();

/** Complete strict Pi and OpenCode role-assignment configuration. */
export const sdlcRoleAssignmentsConfigSchema = z
  .object({
    pi: sdlcHarnessRoleAssignmentsSchema.default({}),
    opencode: sdlcHarnessRoleAssignmentsSchema.default({}),
  })
  .strict();

/** Default-free Pi and OpenCode role-assignment configuration. */
export const sdlcRoleAssignmentsConfigPatchSchema = z
  .object({
    pi: sdlcHarnessRoleAssignmentsPatchSchema.optional(),
    opencode: sdlcHarnessRoleAssignmentsPatchSchema.optional(),
  })
  .strict();

export type SdlcRoleAssignmentConfig = z.output<typeof sdlcRoleAssignmentConfigSchema>;
export type SdlcHarnessRoleAssignments = z.output<typeof sdlcHarnessRoleAssignmentsSchema>;
export type SdlcRoleAssignmentsConfig = z.output<typeof sdlcRoleAssignmentsConfigSchema>;

/** Complete lowest-precedence role assignment value. */
const SDLC_ROLE_ASSIGNMENT_DEFAULTS: SdlcRoleAssignmentsConfig = sdlcRoleAssignmentsConfigSchema.parse({});

/** Portable role assignments contributed to the unified configuration. */
export const sdlcRoleAssignmentsConfigContribution = defineConfigContribution({
  id: 'sdlc-role-assignments',
  path: ['agents', 'sdlc'],
  filePatchSchema: sdlcRoleAssignmentsConfigPatchSchema,
  runtimePatchSchema: sdlcRoleAssignmentsConfigPatchSchema,
  resolvedSchema: sdlcRoleAssignmentsConfigSchema,
  defaults: SDLC_ROLE_ASSIGNMENT_DEFAULTS,
});
