import type { ConfigProvenance, ResolvedConfigSnapshot } from '@neottia/config';
import {
  canonicalJson,
  checksumText,
  compareCodeUnits,
  createAssetManifest,
  createAssetSource,
  fileAssetFromProjection,
  resolveTemplates,
  type AssetManifest,
  type AssetSource,
  type HostConfigAsset,
  type Prerequisite,
  type ResolvedTemplate,
  type Sha256,
  type TemplateLayer,
} from '@neottia/distribution';
import {
  PACKAGE_VERSION_PATTERN,
  type HarnessAdapter,
  type HarnessScope,
  type HostFeature,
  type NeottiaRuntimePackageId,
  type ProjectionDiagnostic,
  type ProjectionResult,
  type TargetPath,
} from '@neottia/harness-adapter';
import { z } from 'zod';

import { createSdlcCompilerContext, type SdlcCompilerContext } from './compiler-context.js';
import {
  DOCUMENT_PROVIDERS,
  ISSUE_PROVIDERS,
  LOCAL_SOURCE_CONTROL_PROVIDERS,
  REMOTE_SOURCE_CONTROL_PROVIDERS,
  documentsCapabilityConfigContribution,
  issuesCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
} from './config.js';
import {
  SDLC_INSTRUCTION_SLOTS,
  selectSdlcInstructionPacks,
  unassignedRoleInstructions,
  validateSdlcInstructionPack,
  validateSdlcRoleInstruction,
  type SdlcInstructionPack,
  type SdlcRoleInstruction,
} from './instructions.js';
import {
  PACKAGED_LIFECYCLE_TEMPLATES,
  SDLC_COMMAND_IDS,
  SDLC_LIFECYCLE,
  SDLC_LIFECYCLE_VERSION,
  SDLC_ROLE_IDS,
  SDLC_TEMPLATE_TOKENS,
  type SdlcCommandId,
  type SdlcLifecycleCommand,
} from './lifecycle.js';

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RUNTIME_PACKAGE_IDS = ['memory', 'issues', 'design-docs', 'searchable'] as const;
const CONFIG_SOURCE_KINDS = ['defaults', 'global', 'project', 'profile', 'environment', 'override'] as const;
const checksumSchema = z.string().regex(SHA256_PATTERN);
const stableIdSchema = z.string().regex(STABLE_ID_PATTERN);
const configurationContextSchema = z
  .object({
    issues: z.object({ provider: z.enum(ISSUE_PROVIDERS) }).strict(),
    documents: z.object({ provider: z.enum(DOCUMENT_PROVIDERS) }).strict(),
    sourceControl: z
      .object({
        local: z.enum(LOCAL_SOURCE_CONTROL_PROVIDERS),
        remote: z.discriminatedUnion('enabled', [
          z.object({ enabled: z.literal(false) }).strict(),
          z.object({ enabled: z.literal(true), provider: z.enum(REMOTE_SOURCE_CONTROL_PROVIDERS) }).strict(),
        ]),
        workspaces: z.boolean(),
      })
      .strict(),
  })
  .strict();
const templateReferenceSchema = z
  .object({ sourceId: z.string().min(1), version: z.string().min(1), checksum: checksumSchema })
  .strict();
const resolvedTemplateSchema = z
  .object({
    id: stableIdSchema,
    content: z.string(),
    checksum: checksumSchema,
    sourceId: z.string().min(1),
    version: z.string().min(1),
    shadowed: z.array(templateReferenceSchema),
  })
  .strict();
const instructionPackSchema = z
  .object({
    id: stableIdSchema,
    slot: z.enum(SDLC_INSTRUCTION_SLOTS),
    provider: stableIdSchema,
    version: z.string().min(1),
    content: z.string().min(1),
    checksum: checksumSchema,
  })
  .strict();
const roleInstructionSchema = z
  .object({
    id: stableIdSchema,
    command: z.enum(SDLC_COMMAND_IDS),
    role: z.enum(SDLC_ROLE_IDS),
    version: z.string().min(1),
    content: z.string().min(1),
    checksum: checksumSchema,
  })
  .strict();
const runtimePackageSchema = z
  .object({ logicalId: z.enum(RUNTIME_PACKAGE_IDS), version: z.string().regex(PACKAGE_VERSION_PATTERN) })
  .strict();
const configurationProvenanceSchema = z
  .object({
    path: z.array(z.string().min(1)),
    source: z
      .object({
        kind: z.enum(CONFIG_SOURCE_KINDS),
        profile: z.string().optional(),
        environment: z.string().optional(),
        legacyPath: z.array(z.string()).optional(),
        label: z.string().optional(),
      })
      .strict(),
  })
  .strict();
const compilerInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    lifecycleVersion: z.literal(SDLC_LIFECYCLE_VERSION),
    compilerVersion: z.string().regex(PACKAGE_VERSION_PATTERN),
    installationId: stableIdSchema,
    harnessId: stableIdSchema,
    scope: z.enum(['project', 'global']),
    configuration: z
      .object({
        checksum: checksumSchema,
        context: configurationContextSchema,
        provenance: z.array(configurationProvenanceSchema),
      })
      .strict(),
    templates: z.array(resolvedTemplateSchema),
    instructions: z.array(instructionPackSchema),
    roles: z.array(roleInstructionSchema),
    runtimePackages: z.array(runtimePackageSchema),
    checksum: checksumSchema,
  })
  .strict();

/** Explicit package requested independently of provider selection. */
export interface SdlcRuntimePackage {
  readonly logicalId: NeottiaRuntimePackageId;
  readonly version: string;
}

/** Portable configuration provenance for one selected compiler value. */
export interface SdlcConfigurationProvenance {
  readonly path: readonly string[];
  readonly source: {
    readonly kind: ConfigProvenance['kind'];
    readonly profile?: string;
    readonly environment?: string;
    readonly legacyPath?: readonly string[];
    readonly label?: string;
  };
}

/** Deterministic, serializable compiler input. */
export interface SdlcCompilerInputManifest {
  readonly schemaVersion: 1;
  readonly lifecycleVersion: string;
  readonly compilerVersion: string;
  readonly installationId: string;
  readonly harnessId: string;
  readonly scope: HarnessScope;
  readonly configuration: {
    readonly checksum: Sha256;
    readonly context: SdlcCompilerContext;
    readonly provenance: readonly SdlcConfigurationProvenance[];
  };
  readonly templates: readonly ResolvedTemplate[];
  readonly instructions: readonly SdlcInstructionPack[];
  readonly roles: readonly SdlcRoleInstruction[];
  readonly runtimePackages: readonly SdlcRuntimePackage[];
  readonly checksum: Sha256;
}

/** Options that turn one resolved snapshot into compiler input. */
export interface CreateSdlcCompilerInputOptions {
  readonly compilerVersion: string;
  readonly installationId?: string;
  readonly harnessId: string;
  readonly scope: HarnessScope;
  readonly templateLayers?: readonly TemplateLayer[];
  readonly instructionPacks?: readonly SdlcInstructionPack[];
  readonly roles?: readonly SdlcRoleInstruction[];
  readonly runtimePackages?: readonly SdlcRuntimePackage[];
}

/** One semantic command in the output manifest. */
export interface CompiledSdlcCommand {
  readonly id: SdlcCommandId;
  readonly templateId: string;
  readonly roleSlots: SdlcLifecycleCommand['roleSlots'];
  readonly roleInstructionIds: readonly string[];
  readonly instructionPackIds: readonly string[];
  readonly allowedNext: readonly SdlcCommandId[];
  readonly approvalPoints: readonly string[];
  readonly stopConditions: readonly string[];
  readonly enforcement: 'guidance-only';
  readonly target: TargetPath;
  readonly bodyChecksum: Sha256;
}

/** Compiler output plus the installer handoff from #114. */
export interface SdlcCompilerOutputManifest {
  readonly schemaVersion: 1;
  readonly lifecycleVersion: string;
  readonly inputChecksum: Sha256;
  readonly harnessId: string;
  readonly scope: HarnessScope;
  readonly commands: readonly CompiledSdlcCommand[];
  readonly assets: AssetManifest;
  readonly checksum: Sha256;
}

/** Adapter projection failure with value-free diagnostics. */
export class SdlcCompilerError extends Error {
  readonly code = 'SDLC_COMPILATION_FAILED';
  readonly diagnostics: readonly ProjectionDiagnostic[];

  constructor(message: string, diagnostics: readonly ProjectionDiagnostic[]) {
    super(message);
    this.name = 'SdlcCompilerError';
    this.diagnostics = Object.freeze(diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })));
  }
}

/** Creates immutable, checksummed compiler input from one resolved snapshot. */
export function createSdlcCompilerInput(
  snapshot: ResolvedConfigSnapshot,
  options: CreateSdlcCompilerInputOptions,
): SdlcCompilerInputManifest {
  if (options.compilerVersion.trim().length === 0) throw new TypeError('Compiler version is required.');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(options.harnessId)) throw new TypeError('Harness ID is invalid.');
  if (options.scope !== 'project' && options.scope !== 'global') throw new TypeError('Harness scope is invalid.');
  const context = createSdlcCompilerContext(snapshot);
  const templates = resolveTemplates(
    SDLC_LIFECYCLE.map((command) => command.templateId),
    [PACKAGED_LIFECYCLE_TEMPLATES, ...(options.templateLayers ?? [])],
  );
  for (const template of templates) validateTemplateSlots(template);
  const instructions = selectSdlcInstructionPacks(context, options.instructionPacks);
  const roles = prepareRoles(options.roles ?? []);
  const runtimePackages = prepareRuntimePackages(options.runtimePackages ?? []);
  const provenance = configurationProvenance(snapshot);
  const configuration = Object.freeze({
    checksum: checksumText(canonicalJson(context)),
    context,
    provenance,
  });
  const unsigned = {
    schemaVersion: 1 as const,
    lifecycleVersion: SDLC_LIFECYCLE_VERSION,
    compilerVersion: options.compilerVersion,
    installationId: options.installationId ?? `sdlc-${options.harnessId}`,
    harnessId: options.harnessId,
    scope: options.scope,
    configuration,
    templates,
    instructions,
    roles,
    runtimePackages,
  };
  const input = { ...unsigned, checksum: checksumText(canonicalJson(unsigned)) };
  validateSdlcCompilerInput(input);
  return deepFreeze(structuredClone(input));
}

/** Compiles canonical lifecycle semantics through one pure harness adapter. */
export function compileSdlc(input: SdlcCompilerInputManifest, adapter: HarnessAdapter): SdlcCompilerOutputManifest {
  validateSdlcCompilerInput(input);
  if (adapter.declaration.id !== input.harnessId) throw new TypeError('Compiler input does not match the adapter.');
  const instructionText = Object.fromEntries(input.instructions.map((pack) => [pack.slot, pack.content])) as Record<
    SdlcInstructionPack['slot'],
    string
  >;
  const assets = [] as Array<ReturnType<typeof fileAssetFromProjection> | HostConfigAsset>;
  const commands: CompiledSdlcCommand[] = [];

  for (const definition of SDLC_LIFECYCLE) {
    const template = requiredTemplate(input.templates, definition.templateId);
    const roles = input.roles.filter((candidate) => candidate.command === definition.id);
    const roleContent = definition.roleSlots
      .map((roleSlot) => {
        const instruction = roles.find((role) => role.role === roleSlot);
        const content = instruction?.content.trimEnd() ?? unassignedRoleInstructions([roleSlot]).trimEnd();
        return `### ${roleSlot}\n\n${content}`;
      })
      .join('\n\n');
    const body = renderTemplate(template.content, instructionText, roleContent);
    const projected = requireProjection(
      adapter.projectPrompt({
        id: definition.id,
        scope: input.scope,
        body,
        metadata: { description: definition.description },
      }),
      `Cannot project ${definition.id}.`,
    );
    const source = commandSource(input, definition, template, roles, body);
    const asset = fileAssetFromProjection(projected, source);
    assets.push(asset);
    commands.push(
      Object.freeze({
        id: definition.id,
        templateId: definition.templateId,
        roleSlots: Object.freeze([...definition.roleSlots]),
        roleInstructionIds: Object.freeze(roles.map((role) => role.id)),
        instructionPackIds: Object.freeze(input.instructions.map((pack) => pack.id)),
        allowedNext: Object.freeze([...definition.allowedNext]),
        approvalPoints: Object.freeze([...definition.approvalPoints]),
        stopConditions: Object.freeze([...definition.stopConditions]),
        enforcement: definition.enforcement,
        target: asset.target,
        bodyChecksum: checksumText(body),
      }),
    );
  }

  for (const runtimePackage of input.runtimePackages) {
    assets.push(projectRuntimePackage(runtimePackage, input, adapter));
  }
  const changedFeatures: HostFeature[] = [
    'asset.prompt',
    ...(input.runtimePackages.length === 0 ? [] : (['config.package'] as const)),
  ];
  const reloadNotice = requireProjection(adapter.reloadNotice({ changedFeatures }), 'Cannot create a reload notice.');
  const manifest = createAssetManifest({
    installationId: input.installationId,
    producer: { name: '@neottia/sdlc', version: input.compilerVersion },
    harnessId: input.harnessId,
    scope: input.scope,
    configChecksum: input.configuration.checksum,
    templates: input.templates,
    prerequisites: prerequisites(input.configuration.context),
    assets,
    reloadNotice,
  });
  const unsigned = {
    schemaVersion: 1 as const,
    lifecycleVersion: input.lifecycleVersion,
    inputChecksum: input.checksum,
    harnessId: input.harnessId,
    scope: input.scope,
    commands: commands.sort((left, right) => compareCodeUnits(left.id, right.id)),
    assets: manifest,
  };
  return deepFreeze({ ...unsigned, checksum: checksumText(canonicalJson(unsigned)) });
}

/** Validates a decoded input before adapter code runs. */
export function validateSdlcCompilerInput(input: SdlcCompilerInputManifest): void {
  if (!compilerInputSchema.safeParse(input).success) throw new TypeError('SDLC compiler input schema is invalid.');
  if (checksumText(canonicalJson(input.configuration.context)) !== input.configuration.checksum) {
    throw new TypeError('SDLC compiler configuration checksum does not match.');
  }
  if (
    input.configuration.context.sourceControl.workspaces &&
    input.configuration.context.sourceControl.local !== 'git'
  ) {
    throw new TypeError('SDLC compiler configuration is semantically invalid.');
  }
  validateConfigurationProvenance(input.configuration.provenance);
  validateResolvedTemplates(input.templates);
  validateSelectedInstructions(input.configuration.context, input.instructions);

  const canonicalRoles = prepareRoles(input.roles);
  if (canonicalJson(canonicalRoles) !== canonicalJson(input.roles)) {
    throw new TypeError('Role instructions are not in canonical order.');
  }
  const canonicalPackages = prepareRuntimePackages(input.runtimePackages);
  if (canonicalJson(canonicalPackages) !== canonicalJson(input.runtimePackages)) {
    throw new TypeError('Runtime packages are not in canonical order.');
  }
  const { checksum, ...unsigned } = input;
  if (checksumText(canonicalJson(unsigned)) !== checksum)
    throw new TypeError('SDLC compiler input checksum does not match.');
}

/** Projects one explicitly requested runtime package as reviewable host configuration. */
function projectRuntimePackage(
  runtimePackage: SdlcRuntimePackage,
  input: SdlcCompilerInputManifest,
  adapter: HarnessAdapter,
): HostConfigAsset {
  const declaration = requireProjection(
    adapter.declarePackage({
      logicalId: runtimePackage.logicalId,
      scope: input.scope,
      version: runtimePackage.version,
    }),
    `Cannot declare runtime package ${runtimePackage.logicalId}.`,
  );
  const plan = requireProjection(
    adapter.planHostConfiguration({ kind: 'package', package: declaration }),
    `Cannot configure runtime package ${runtimePackage.logicalId}.`,
  );
  const source = createAssetSource({
    kind: 'generated',
    id: `sdlc.runtime.${runtimePackage.logicalId}`,
    version: runtimePackage.version,
    content: canonicalJson({ declaration, plan }),
  });
  return Object.freeze({
    kind: 'host-config',
    id: `sdlc.runtime.${runtimePackage.logicalId}`,
    plan,
    source,
  });
}

/** Creates provenance for a command assembled from template and instruction inputs. */
function commandSource(
  input: SdlcCompilerInputManifest,
  definition: SdlcLifecycleCommand,
  template: ResolvedTemplate,
  roles: readonly SdlcRoleInstruction[],
  body: string,
): AssetSource {
  return createAssetSource({
    kind: 'generated',
    id: `sdlc.command.${definition.id}`,
    version: input.compilerVersion,
    content: canonicalJson({
      body,
      inputChecksum: input.checksum,
      template: {
        id: template.id,
        sourceId: template.sourceId,
        version: template.version,
        checksum: template.checksum,
      },
      instructions: input.instructions.map(({ id, version, checksum }) => ({ id, version, checksum })),
      roles: roles.map(({ id, role, version, checksum }) => ({ id, role, version, checksum })),
    }),
  });
}

/** Replaces every required slot exactly at compile time. */
function renderTemplate(
  content: string,
  instructions: Readonly<Record<SdlcInstructionPack['slot'], string>>,
  role: string,
): string {
  const replacements: Readonly<Record<string, string>> = Object.freeze({
    [SDLC_TEMPLATE_TOKENS.issues]: instructions.issues,
    [SDLC_TEMPLATE_TOKENS.documents]: instructions.documents,
    [SDLC_TEMPLATE_TOKENS.sourceControlLocal]: instructions['source-control.local'],
    [SDLC_TEMPLATE_TOKENS.sourceControlRemote]: instructions['source-control.remote'],
    [SDLC_TEMPLATE_TOKENS.role]: role,
  });
  let output = content;
  for (const [token, replacement] of Object.entries(replacements))
    output = output.replaceAll(token, replacement.trimEnd());
  if (/\{\{neottia\.[^}]+\}\}/u.test(output)) throw new TypeError('Lifecycle template has an unresolved slot.');
  return output.endsWith('\n') ? output : `${output}\n`;
}

/** Requires every provider and role slot exactly once in a lifecycle template. */
function validateTemplateSlots(template: ResolvedTemplate): void {
  for (const token of Object.values(SDLC_TEMPLATE_TOKENS)) {
    if (template.content.split(token).length !== 2) {
      throw new TypeError(`Lifecycle template ${template.id} must contain slot ${token} exactly once.`);
    }
  }
}

/** Finds one resolved template by stable ID. */
function requiredTemplate(templates: readonly ResolvedTemplate[], id: string): ResolvedTemplate {
  const matches = templates.filter((template) => template.id === id);
  if (matches.length !== 1) throw new TypeError(`Resolved lifecycle template ${id} is missing or duplicated.`);
  return matches[0]!;
}

/** Requires the fixed compiler provenance paths in their canonical order. */
function validateConfigurationProvenance(provenance: readonly SdlcConfigurationProvenance[]): void {
  const expectedPaths = [
    ['capabilities', 'issues', 'provider'],
    ['capabilities', 'documents', 'provider'],
    ['capabilities', 'source_control', 'local'],
    ['capabilities', 'source_control', 'remote'],
    ['capabilities', 'source_control', 'workspaces'],
  ];
  if (canonicalJson(provenance.map((entry) => entry.path)) !== canonicalJson(expectedPaths)) {
    throw new TypeError('SDLC compiler configuration provenance is invalid.');
  }
}

/** Checks template identity, order, content checksums, and insertion slots. */
function validateResolvedTemplates(templates: readonly ResolvedTemplate[]): void {
  const expectedIds = SDLC_LIFECYCLE.map((command) => command.templateId).sort(compareCodeUnits);
  if (templates.length !== expectedIds.length) throw new TypeError('Resolved lifecycle templates are incomplete.');
  for (const [index, template] of templates.entries()) {
    if (template.id !== expectedIds[index])
      throw new TypeError('Resolved lifecycle templates are not in canonical order.');
    if (checksumText(template.content) !== template.checksum) {
      throw new TypeError(`Resolved lifecycle template ${template.id} checksum does not match.`);
    }
    validateTemplateSlots(template);
  }
}

/** Requires one canonical instruction pack matching every selected provider. */
function validateSelectedInstructions(
  context: SdlcCompilerContext,
  instructions: readonly SdlcInstructionPack[],
): void {
  const expectedProviders: Readonly<Record<SdlcInstructionPack['slot'], string>> = Object.freeze({
    issues: context.issues.provider,
    documents: context.documents.provider,
    'source-control.local': context.sourceControl.local,
    'source-control.remote': context.sourceControl.remote.enabled ? context.sourceControl.remote.provider : 'none',
  });
  const expectedSlots = [...SDLC_INSTRUCTION_SLOTS].sort(compareCodeUnits);
  if (instructions.length !== expectedSlots.length)
    throw new TypeError('SDLC instruction pack selection is incomplete.');
  for (const [index, pack] of instructions.entries()) {
    validateSdlcInstructionPack(pack);
    const slot = expectedSlots[index]!;
    if (pack.slot !== slot) throw new TypeError('SDLC instruction packs are not in canonical order.');
    if (pack.provider !== expectedProviders[slot]) {
      throw new TypeError(`Instruction pack does not match selected provider for ${slot}.`);
    }
  }
}

/** Validates and orders role instructions independently of caller enumeration. */
function prepareRoles(roles: readonly SdlcRoleInstruction[]): readonly SdlcRoleInstruction[] {
  const points = new Set<string>();
  for (const role of roles) {
    validateSdlcRoleInstruction(role);
    const definition = SDLC_LIFECYCLE.find((command) => command.id === role.command)!;
    if (!definition.roleSlots.includes(role.role)) {
      throw new TypeError(`Role ${role.role} is not an invocation point for ${role.command}.`);
    }
    const point = `${role.command}:${role.role}`;
    if (points.has(point)) throw new TypeError(`Role instruction point ${point} is duplicated.`);
    points.add(point);
  }
  return Object.freeze(
    [...roles].sort((left, right) => {
      const commandOrder =
        SDLC_LIFECYCLE.findIndex((command) => command.id === left.command) -
        SDLC_LIFECYCLE.findIndex((command) => command.id === right.command);
      if (commandOrder !== 0) return commandOrder;
      const definition = SDLC_LIFECYCLE.find((command) => command.id === left.command)!;
      return definition.roleSlots.indexOf(left.role) - definition.roleSlots.indexOf(right.role);
    }),
  );
}

/** Validates explicit package versions without deriving them from provider selection. */
function prepareRuntimePackages(packages: readonly SdlcRuntimePackage[]): readonly SdlcRuntimePackage[] {
  const ids = new Set<NeottiaRuntimePackageId>();
  for (const runtimePackage of packages) {
    if (!RUNTIME_PACKAGE_IDS.includes(runtimePackage.logicalId)) {
      throw new TypeError(`Runtime package ${String(runtimePackage.logicalId)} is invalid.`);
    }
    if (ids.has(runtimePackage.logicalId))
      throw new TypeError(`Runtime package ${runtimePackage.logicalId} is duplicated.`);
    if (!PACKAGE_VERSION_PATTERN.test(runtimePackage.version)) {
      throw new TypeError(`Runtime package ${runtimePackage.logicalId} version is invalid.`);
    }
    ids.add(runtimePackage.logicalId);
  }
  return Object.freeze(
    packages
      .map((runtimePackage) => Object.freeze({ ...runtimePackage }))
      .sort((left, right) => compareCodeUnits(left.logicalId, right.logicalId)),
  );
}

/** Records only portable source metadata for selected configuration leaves. */
function configurationProvenance(snapshot: ResolvedConfigSnapshot): readonly SdlcConfigurationProvenance[] {
  const leaves = [
    {
      path: ['capabilities', 'issues', 'provider'],
      source: snapshot.sourceOf(issuesCapabilityConfigContribution, ['provider']),
    },
    {
      path: ['capabilities', 'documents', 'provider'],
      source: snapshot.sourceOf(documentsCapabilityConfigContribution, ['provider']),
    },
    {
      path: ['capabilities', 'source_control', 'local'],
      source: snapshot.sourceOf(sourceControlCapabilityConfigContribution, ['local']),
    },
    {
      path: ['capabilities', 'source_control', 'remote'],
      source: snapshot.sourceOf(sourceControlCapabilityConfigContribution, ['remote']),
    },
    {
      path: ['capabilities', 'source_control', 'workspaces'],
      source: snapshot.sourceOf(sourceControlCapabilityConfigContribution, ['workspaces']),
    },
  ];
  return Object.freeze(
    leaves.map(({ path, source }) =>
      Object.freeze({
        path: Object.freeze(path),
        source: portableProvenance(source ?? { kind: 'defaults' }),
      }),
    ),
  );
}

/** Removes machine-specific file paths while retaining the source decision trail. */
function portableProvenance(source: ConfigProvenance): SdlcConfigurationProvenance['source'] {
  return Object.freeze({
    kind: source.kind,
    ...(source.profile === undefined ? {} : { profile: source.profile }),
    ...(source.environment === undefined ? {} : { environment: source.environment }),
    ...(source.legacyPath === undefined ? {} : { legacyPath: Object.freeze([...source.legacyPath]) }),
    ...(source.label === undefined ? {} : { label: source.label }),
  });
}

/** Declares non-mutating prerequisite checks for selected local tools. */
function prerequisites(context: SdlcCompilerContext): readonly Prerequisite[] {
  return Object.freeze([
    Object.freeze({
      id: `source-control.${context.sourceControl.local}`,
      category: 'tool' as const,
      description: `${context.sourceControl.local} source control`,
      check: Object.freeze({ kind: 'command' as const, command: context.sourceControl.local }),
      instructions: `Install ${context.sourceControl.local} and make it available on PATH.`,
    }),
  ]);
}

/** Returns a projection value or raises all adapter diagnostics together. */
function requireProjection<T>(result: ProjectionResult<T>, message: string): T {
  if (result.value === undefined) throw new SdlcCompilerError(message, result.diagnostics);
  return result.value;
}

/** Recursively freezes detached compiler artifacts. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}
