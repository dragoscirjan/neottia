import { defineConfigContribution } from '@neottia/config';
import { z } from 'zod';

/** Shared exact digest format used by configured skill sources. */
const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const idSchema = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);

/** Strict installation target selected for manifest compilation. */
export const harnessInstallTargetSchema = z.object({ id: idSchema, scope: z.enum(['project', 'global']) }).strict();
/** Complete harness installation settings. */
export const harnessInstallConfigSchema = z
  .object({ targets: z.array(harnessInstallTargetSchema).default([]) })
  .strict();
/** Default-free harness settings accepted from each source. */
export const harnessInstallConfigPatchSchema = z
  .object({ targets: z.array(harnessInstallTargetSchema).optional() })
  .strict();

/** Exact static skill source delegated to the bundled skills package. */
export const staticSkillConfigSchema = z
  .object({
    id: idSchema,
    source: z.string().min(1),
    revision: z.string().min(1),
    integrity: checksumSchema,
    skills: z.array(idSchema).min(1),
  })
  .strict();
/** Complete asset installation settings. */
export const assetInstallConfigSchema = z
  .object({ static_skills: z.array(staticSkillConfigSchema).default([]) })
  .strict();
/** Default-free asset settings accepted from each source. */
export const assetInstallConfigPatchSchema = z
  .object({ static_skills: z.array(staticSkillConfigSchema).optional() })
  .strict();

/** Explicit package or override source for template discovery. */
export const templateSourceConfigSchema = z
  .object({ id: idSchema, path: z.string().min(1), version: z.string().min(1) })
  .strict();
/** Complete deterministic template source settings. */
export const templateInstallConfigSchema = z
  .object({
    packages: z.array(templateSourceConfigSchema).default([]),
    global_overrides: z.array(templateSourceConfigSchema).default([]),
    project_overrides: z.array(templateSourceConfigSchema).default([]),
  })
  .strict();
/** Default-free template settings accepted from each source. */
export const templateInstallConfigPatchSchema = z
  .object({
    packages: z.array(templateSourceConfigSchema).optional(),
    global_overrides: z.array(templateSourceConfigSchema).optional(),
    project_overrides: z.array(templateSourceConfigSchema).optional(),
  })
  .strict();

export type HarnessInstallConfig = z.output<typeof harnessInstallConfigSchema>;
export type AssetInstallConfig = z.output<typeof assetInstallConfigSchema>;
export type TemplateInstallConfig = z.output<typeof templateInstallConfigSchema>;

/** Harness and scope selections owned by the distribution configuration. */
export const harnessInstallConfigContribution = defineConfigContribution({
  id: 'distribution-harness-install',
  path: ['harnesses', 'install'],
  filePatchSchema: harnessInstallConfigPatchSchema,
  runtimePatchSchema: harnessInstallConfigPatchSchema,
  resolvedSchema: harnessInstallConfigSchema,
  defaults: harnessInstallConfigSchema.parse({}),
});

/** Static third-party skill sources owned by the distribution configuration. */
export const assetInstallConfigContribution = defineConfigContribution({
  id: 'distribution-asset-install',
  path: ['assets', 'install'],
  filePatchSchema: assetInstallConfigPatchSchema,
  runtimePatchSchema: assetInstallConfigPatchSchema,
  resolvedSchema: assetInstallConfigSchema,
  defaults: assetInstallConfigSchema.parse({}),
});

/** Explicit package and override sources owned by the distribution configuration. */
export const templateInstallConfigContribution = defineConfigContribution({
  id: 'distribution-template-install',
  path: ['templates', 'install'],
  filePatchSchema: templateInstallConfigPatchSchema,
  runtimePatchSchema: templateInstallConfigPatchSchema,
  resolvedSchema: templateInstallConfigSchema,
  defaults: templateInstallConfigSchema.parse({}),
});
