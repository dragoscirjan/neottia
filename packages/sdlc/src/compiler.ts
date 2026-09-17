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

import {
  createSdlcCompilerContext,
  validateSdlcCompilerContext,
  type SdlcCompilerContext,
} from './compiler-context.js';
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
  forgeBaseUrlSchema,
  forgeConnectionsConfigContribution,
  forgeCredentialEnvironmentSchema,
  forgeMcpServiceSchema,
} from './forge-config.js';
import { createForgeInstructionPacks } from './forge-instructions.js';
import { FORGE_CAPABILITIES, FORGE_PROVIDERS, FORGE_SUPPORT_DECLARATIONS } from './forge-support.js';
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
  SDLC_COMMAND_IDS,
  SDLC_CONTENT_TEMPLATE_ID,
  SDLC_LAYOUT_TEMPLATE_ID,
  SDLC_LIFECYCLE,
  SDLC_LIFECYCLE_VERSION,
  SDLC_ROLE_IDS,
  type SdlcCommandId,
  type SdlcLifecycleCommand,
  type SdlcRoleId,
} from './lifecycle.js';
import {
  createSandboxSecurityPolicy,
  createSynchronousArrayLoader,
  createSynchronousEnvironment,
} from '../vendor/twing/index.cjs';

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RUNTIME_PACKAGE_IDS = ['memory', 'issues', 'design-docs', 'searchable'] as const;
const CONFIG_SOURCE_KINDS = ['defaults', 'global', 'project', 'profile', 'environment', 'override'] as const;
const MAX_TEMPLATE_BYTES = 1024 * 1024;
const MAX_FRAGMENT_BYTES = 256 * 1024;
const MAX_LIFECYCLE_TEXT_LENGTH = 16 * 1024;
const MAX_LIFECYCLE_POINTS = 16;
const MAX_RENDERED_COMMAND_BYTES = 2 * 1024 * 1024;
const TWIG_ALLOWED_TAGS = ['block', 'deprecated', 'extends', 'flush', 'for', 'if', 'spaceless', 'verbatim', 'with'];
const TWIG_ALLOWED_FILTERS = [
  'abs',
  'capitalize',
  'default',
  'first',
  'keys',
  'last',
  'length',
  'lower',
  'reverse',
  'round',
  'slice',
  'sort',
  'striptags',
  'title',
  'trim',
  'upper',
];
const TWIG_ALLOWED_FUNCTIONS = ['attribute', 'cycle', 'max', 'min', 'parent', 'source'];
const TWIG_CONTEXT_PROPERTIES = [
  'allowedNext',
  'approvalPoints',
  'assigned',
  'content',
  'description',
  'documents',
  'enforcement',
  'first',
  'id',
  'index',
  'index0',
  'instructionId',
  'issues',
  'last',
  'length',
  'local',
  'parent',
  'remote',
  'revindex',
  'revindex0',
  'roleSlots',
  'sourceControl',
  'stopConditions',
  'templateId',
];
const checksumSchema = z.string().regex(SHA256_PATTERN);
const stableIdSchema = z.string().regex(STABLE_ID_PATTERN);
const forgeMcpServiceContextSchema = forgeMcpServiceSchema;
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
    forges: z.array(
      z
        .object({
          provider: z.enum(FORGE_PROVIDERS),
          capabilities: z.array(z.enum(FORGE_CAPABILITIES)),
          baseUrl: forgeBaseUrlSchema,
          credentialEnvironment: forgeCredentialEnvironmentSchema,
          allowInsecureHttp: z.boolean(),
          mcp: z
            .object({
              issues: forgeMcpServiceContextSchema.optional(),
              documents: forgeMcpServiceContextSchema.optional(),
              remoteSourceControl: forgeMcpServiceContextSchema.optional(),
            })
            .strict(),
        })
        .strict(),
    ),
  })
  .strict();
const lifecycleContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    lifecycleVersion: z.literal(SDLC_LIFECYCLE_VERSION),
    commands: z.array(
      z
        .object({
          id: z.enum(SDLC_COMMAND_IDS),
          description: z.string().min(1).max(MAX_LIFECYCLE_TEXT_LENGTH),
          approvalPoints: z.array(z.string().min(1).max(MAX_LIFECYCLE_TEXT_LENGTH)).min(1).max(MAX_LIFECYCLE_POINTS),
          stopConditions: z.array(z.string().min(1).max(MAX_LIFECYCLE_TEXT_LENGTH)).min(1).max(MAX_LIFECYCLE_POINTS),
        })
        .strict(),
    ),
  })
  .strict();
const templateReferenceSchema = z
  .object({ sourceId: z.string().min(1), version: z.string().min(1), checksum: checksumSchema })
  .strict();
const resolvedTemplateSchema = z
  .object({
    id: stableIdSchema,
    content: z.string().max(MAX_TEMPLATE_BYTES),
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
    content: z.string().min(1).max(MAX_FRAGMENT_BYTES),
    checksum: checksumSchema,
  })
  .strict();
const roleInstructionSchema = z
  .object({
    id: stableIdSchema,
    command: z.enum(SDLC_COMMAND_IDS),
    role: z.enum(SDLC_ROLE_IDS),
    version: z.string().min(1),
    content: z.string().min(1).max(MAX_FRAGMENT_BYTES),
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
    schemaVersion: z.literal(2),
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

/** Packaged prose for one canonical lifecycle command. */
interface SdlcLifecycleCommandContent {
  readonly id: SdlcCommandId;
  readonly description: string;
  readonly approvalPoints: readonly string[];
  readonly stopConditions: readonly string[];
}

/** Parsed packaged lifecycle prose and its schema version. */
interface SdlcLifecycleContent {
  readonly schemaVersion: 1;
  readonly lifecycleVersion: string;
  readonly commands: readonly SdlcLifecycleCommandContent[];
}

/** Complete command value exposed to a lifecycle Twig template. */
export interface SdlcTemplateCommand extends SdlcLifecycleCommand {
  readonly description: string;
  readonly approvalPoints: readonly string[];
  readonly stopConditions: readonly string[];
}

/** One role fragment exposed to a lifecycle Twig template. */
export interface SdlcTemplateRole {
  readonly id: SdlcRoleId;
  readonly content: string;
  readonly assigned: boolean;
  readonly instructionId?: string;
}

/** Tracks one fragment's exact output during validation renders. */
class TrackedTemplateFragment {
  readonly wrapped: string;
  renderCount = 0;

  constructor(
    readonly slot: string,
    readonly value: string,
  ) {
    const marker = checksumText(`${slot}\0${value}`).slice('sha256:'.length, 'sha256:'.length + 16);
    this.wrapped = `NEOTTIA_FRAGMENT_${marker}_START${value}NEOTTIA_FRAGMENT_${marker}_END`;
  }

  toString(): string {
    this.renderCount += 1;
    return this.wrapped;
  }
}

/** Stable render context available to packaged and overridden Twig templates. */
export interface SdlcTemplateContext {
  readonly command: SdlcTemplateCommand;
  readonly instructions: {
    readonly issues: string;
    readonly documents: string;
    readonly sourceControl: {
      readonly local: string;
      readonly remote: string;
    };
  };
  readonly roles: readonly SdlcTemplateRole[];
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
  readonly schemaVersion: 2;
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
  /** Explicit layers returned by the filesystem loader or another trusted source. */
  readonly templateLayers: readonly TemplateLayer[];
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
  readonly schemaVersion: 2;
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
    [SDLC_CONTENT_TEMPLATE_ID, SDLC_LAYOUT_TEMPLATE_ID, ...SDLC_LIFECYCLE.map((command) => command.templateId)],
    options.templateLayers,
  );
  const instructions = selectSdlcInstructionPacks(context, [
    ...createForgeInstructionPacks(context),
    ...(options.instructionPacks ?? []),
  ]);
  const roles = prepareRoles(options.roles ?? []);
  const runtimePackages = prepareRuntimePackages(options.runtimePackages ?? []);
  const provenance = configurationProvenance(snapshot, context);
  const configuration = Object.freeze({
    checksum: checksumText(canonicalJson(context)),
    context,
    provenance,
  });
  const unsigned = {
    schemaVersion: 2 as const,
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
  const renderer = createTemplateRenderer(input.templates);
  const lifecycleContent = parseLifecycleContent(input.templates);
  const assets = [] as Array<ReturnType<typeof fileAssetFromProjection> | HostConfigAsset>;
  const commands: CompiledSdlcCommand[] = [];

  for (const definition of SDLC_LIFECYCLE) {
    const template = requiredTemplate(input.templates, definition.templateId);
    const content = requiredLifecycleContent(lifecycleContent, definition.id);
    const roles = input.roles.filter((candidate) => candidate.command === definition.id);
    const templateRoles = createTemplateRoles(definition, roles);
    const rendered = renderTrackedLifecycleTemplate(
      renderer,
      template.id,
      definition,
      content,
      instructionText,
      templateRoles,
    );
    const renderedInstructions = input.instructions.filter((pack) => rendered.instructionSlots.includes(pack.slot));
    const body = rendered.body;
    const projected = requireProjection(
      adapter.projectPrompt({
        id: definition.id,
        scope: input.scope,
        body,
        metadata: { description: content.description },
      }),
      `Cannot project ${definition.id}.`,
    );
    const source = commandSource(input, definition, template, renderedInstructions, roles, body);
    const asset = fileAssetFromProjection(projected, source);
    assets.push(asset);
    commands.push(
      Object.freeze({
        id: definition.id,
        templateId: definition.templateId,
        roleSlots: Object.freeze([...definition.roleSlots]),
        roleInstructionIds: Object.freeze(roles.map((role) => role.id)),
        instructionPackIds: Object.freeze(renderedInstructions.map((pack) => pack.id)),
        allowedNext: Object.freeze([...definition.allowedNext]),
        approvalPoints: Object.freeze([...content.approvalPoints]),
        stopConditions: Object.freeze([...content.stopConditions]),
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
    schemaVersion: 2 as const,
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
  const { checksum, ...unsigned } = input;
  if (checksumText(canonicalJson(unsigned)) !== checksum)
    throw new TypeError('SDLC compiler input checksum does not match.');
  if (checksumText(canonicalJson(input.configuration.context)) !== input.configuration.checksum) {
    throw new TypeError('SDLC compiler configuration checksum does not match.');
  }
  if (
    input.configuration.context.sourceControl.workspaces &&
    input.configuration.context.sourceControl.local !== 'git'
  ) {
    throw new TypeError('SDLC compiler configuration is semantically invalid.');
  }
  validateSdlcCompilerContext(input.configuration.context);
  validateConfigurationProvenance(input.configuration.context, input.configuration.provenance);
  validateSelectedInstructions(input.configuration.context, input.instructions);

  const canonicalRoles = prepareRoles(input.roles);
  if (canonicalJson(canonicalRoles) !== canonicalJson(input.roles)) {
    throw new TypeError('Role instructions are not in canonical order.');
  }
  validateResolvedTemplates(input.templates, input.instructions, canonicalRoles);
  const canonicalPackages = prepareRuntimePackages(input.runtimePackages);
  if (canonicalJson(canonicalPackages) !== canonicalJson(input.runtimePackages)) {
    throw new TypeError('Runtime packages are not in canonical order.');
  }
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
  instructions: readonly SdlcInstructionPack[],
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
      instructions: instructions.map(({ id, version, checksum }) => ({ id, version, checksum })),
      roles: roles.map(({ id, role, version, checksum }) => ({ id, role, version, checksum })),
    }),
  });
}

/** Creates a deterministic, filesystem-free Twig renderer for resolved templates. */
function createTemplateRenderer(templates: readonly ResolvedTemplate[]): {
  readonly render: (id: string, context: SdlcTemplateContext) => string;
} {
  const loader = createSynchronousArrayLoader(
    Object.fromEntries(templates.map((template) => [template.id, template.content])),
  );
  const sandboxPolicy = createSandboxSecurityPolicy({
    allowedTags: [...TWIG_ALLOWED_TAGS],
    allowedFilters: [...TWIG_ALLOWED_FILTERS],
    allowedFunctions: [...TWIG_ALLOWED_FUNCTIONS],
    allowedMethods: new Map([[TrackedTemplateFragment, ['toString']]]),
    allowedProperties: new Map([[Object, [...TWIG_CONTEXT_PROPERTIES]]]),
  });
  const environment = createSynchronousEnvironment(loader, { sandboxPolicy });
  return Object.freeze({
    render(id: string, context: SdlcTemplateContext): string {
      const rendered = environment.render(id, context, { sandboxed: true, strict: true });
      const output = rendered.endsWith('\n') ? rendered : `${rendered}\n`;
      if (Buffer.byteLength(output, 'utf8') > MAX_RENDERED_COMMAND_BYTES) {
        throw new TypeError(`Rendered lifecycle template ${id} exceeds its byte limit.`);
      }
      return output;
    },
  });
}

/** Builds ordered role fragments for one canonical invocation point set. */
function createTemplateRoles(
  command: SdlcLifecycleCommand,
  roles: readonly SdlcRoleInstruction[],
): readonly SdlcTemplateRole[] {
  return Object.freeze(
    command.roleSlots.map((roleSlot): SdlcTemplateRole => {
      const instruction = roles.find((role) => role.role === roleSlot);
      return Object.freeze({
        id: roleSlot,
        content: instruction?.content.trimEnd() ?? unassignedRoleInstructions([roleSlot]).trimEnd(),
        assigned: instruction !== undefined,
        ...(instruction === undefined ? {} : { instructionId: instruction.id }),
      });
    }),
  );
}

/** Renders one command and records which instruction blocks the template used. */
function renderTrackedLifecycleTemplate(
  renderer: ReturnType<typeof createTemplateRenderer>,
  templateId: string,
  command: SdlcLifecycleCommand,
  content: SdlcLifecycleCommandContent,
  instructions: Readonly<Record<SdlcInstructionPack['slot'], string>>,
  roles: readonly SdlcTemplateRole[],
): { readonly body: string; readonly instructionSlots: readonly SdlcInstructionPack['slot'][] } {
  const tracked = createTrackedTemplateContext(command, content, instructions, roles);
  const output = renderer.render(templateId, tracked.context);
  validateTrackedFragments(templateId, output, tracked.fragments);
  let body = output;
  for (const fragment of tracked.fragments) {
    if (fragment.renderCount === 1) body = body.replace(fragment.wrapped, () => fragment.value);
  }
  const instructionSlots = tracked.fragments.flatMap((fragment) => {
    if (fragment.renderCount !== 1) return [];
    const slot = instructionSlotForFragment(fragment.slot);
    return slot === undefined ? [] : [slot];
  });
  return Object.freeze({ body, instructionSlots: Object.freeze(instructionSlots) });
}

/** Maps a tracked Twig path to its instruction-pack slot. */
function instructionSlotForFragment(slot: string): SdlcInstructionPack['slot'] | undefined {
  if (slot === 'instructions.issues') return 'issues';
  if (slot === 'instructions.documents') return 'documents';
  if (slot === 'instructions.sourceControl.local') return 'source-control.local';
  if (slot === 'instructions.sourceControl.remote') return 'source-control.remote';
  return undefined;
}

/** Builds a validation context whose fragment objects record exact output. */
function createTrackedTemplateContext(
  command: SdlcLifecycleCommand,
  content: SdlcLifecycleCommandContent,
  instructions: Readonly<Record<SdlcInstructionPack['slot'], string>>,
  roles: readonly SdlcTemplateRole[],
): { readonly context: SdlcTemplateContext; readonly fragments: readonly TrackedTemplateFragment[] } {
  const fragments: TrackedTemplateFragment[] = [];
  const tracked = (slot: string, value: string): string => {
    if (value.length === 0) throw new TypeError(`Lifecycle template has an empty ${slot} fragment.`);
    const fragment = new TrackedTemplateFragment(slot, value);
    fragments.push(fragment);
    return fragment as unknown as string;
  };
  const trackedRoles = roles.map((role) =>
    Object.freeze({
      ...role,
      content: tracked(`roles.${role.id}`, role.content),
    }),
  );
  return Object.freeze({
    context: Object.freeze({
      command: Object.freeze({
        ...command,
        description: content.description,
        approvalPoints: Object.freeze([...content.approvalPoints]),
        stopConditions: Object.freeze([...content.stopConditions]),
      }),
      instructions: Object.freeze({
        issues: tracked('instructions.issues', instructions.issues.trimEnd()),
        documents: tracked('instructions.documents', instructions.documents.trimEnd()),
        sourceControl: Object.freeze({
          local: tracked('instructions.sourceControl.local', instructions['source-control.local'].trimEnd()),
          remote: tracked('instructions.sourceControl.remote', instructions['source-control.remote'].trimEnd()),
        }),
      }),
      roles: Object.freeze(trackedRoles),
    }),
    fragments: Object.freeze(fragments),
  });
}

/** Requires roles once and permits each template-selected instruction at most once. */
function validateTrackedFragments(
  templateId: string,
  output: string,
  fragments: readonly TrackedTemplateFragment[],
): void {
  for (const fragment of fragments) {
    const occurrences = output.split(fragment.wrapped).length - 1;
    const instruction = instructionSlotForFragment(fragment.slot) !== undefined;
    if (occurrences !== fragment.renderCount || (instruction ? fragment.renderCount > 1 : fragment.renderCount !== 1)) {
      const cardinality = instruction ? 'at most once' : 'exactly once';
      throw new TypeError(`Lifecycle template ${templateId} must render ${fragment.slot} ${cardinality}.`);
    }
  }
}

/** Parses and validates packaged lifecycle prose. */
function parseLifecycleContent(templates: readonly ResolvedTemplate[]): SdlcLifecycleContent {
  const template = requiredTemplate(templates, SDLC_CONTENT_TEMPLATE_ID);
  let decoded: unknown;
  try {
    decoded = JSON.parse(template.content);
  } catch {
    throw new TypeError('Packaged SDLC lifecycle content is not valid JSON.');
  }
  const result = lifecycleContentSchema.safeParse(decoded);
  if (!result.success) throw new TypeError('Packaged SDLC lifecycle content schema is invalid.');
  if (canonicalJson(result.data.commands.map((command) => command.id)) !== canonicalJson(SDLC_COMMAND_IDS)) {
    throw new TypeError('Packaged SDLC lifecycle content is not in canonical order.');
  }
  return deepFreeze(result.data);
}

/** Finds one command's packaged prose. */
function requiredLifecycleContent(
  content: SdlcLifecycleContent,
  commandId: SdlcCommandId,
): SdlcLifecycleCommandContent {
  const matches = content.commands.filter((command) => command.id === commandId);
  if (matches.length !== 1)
    throw new TypeError(`Packaged lifecycle content for ${commandId} is missing or duplicated.`);
  return matches[0]!;
}

/** Rejects dynamic or cyclic inheritance before Twing evaluates templates. */
function validateTemplateDependencies(templates: readonly ResolvedTemplate[]): void {
  const staticExtends = /\{%-?\s*extends\s+(['"])([^'"]+)\1\s*-?%\}/gu;
  const anyExtends = /\{%-?\s*extends\b/gu;
  const staticFor =
    /\{%-?\s*for\s+[a-zA-Z_][a-zA-Z0-9_]*\s+in\s+(?:command\.(?:approvalPoints|stopConditions)|roles)\s*-?%\}/gu;
  const loopTag = /\{%-?\s*(for|endfor)\b[^%]*-?%\}/gu;
  for (const template of templates) {
    if (/\bblock\s*\(/u.test(template.content)) {
      throw new TypeError(`Lifecycle template ${template.id} uses block(), which is not allowed.`);
    }
    const occurrences = template.content.match(anyExtends)?.length ?? 0;
    const targets = [...template.content.matchAll(staticExtends)].map((match) => match[2]!);
    const commandTemplate = SDLC_LIFECYCLE.some((command) => command.templateId === template.id);
    if (occurrences !== targets.length || targets.length > 1) {
      throw new TypeError(`Lifecycle template ${template.id} has an invalid extends declaration.`);
    }
    if (targets.length === 1 && (!commandTemplate || targets[0] !== SDLC_LAYOUT_TEMPLATE_ID)) {
      throw new TypeError(`Lifecycle template ${template.id} may extend only ${SDLC_LAYOUT_TEMPLATE_ID}.`);
    }

    const forCount = template.content.match(/\{%-?\s*for\b/gu)?.length ?? 0;
    if (forCount !== (template.content.match(staticFor)?.length ?? 0)) {
      throw new TypeError(`Lifecycle template ${template.id} has an unbounded Twig loop.`);
    }
    let depth = 0;
    for (const match of template.content.matchAll(loopTag)) {
      depth += match[1] === 'for' ? 1 : -1;
      if (depth > 1) throw new TypeError(`Lifecycle template ${template.id} has nested Twig loops.`);
      if (depth < 0) throw new TypeError(`Lifecycle template ${template.id} has unmatched Twig loops.`);
    }
    if (depth !== 0) throw new TypeError(`Lifecycle template ${template.id} has unmatched Twig loops.`);
  }
}

/** Requires direct output expressions for every compiler-supplied fragment. */
function validateTemplateFragmentReferences(template: ResolvedTemplate, templates: readonly ResolvedTemplate[]): void {
  const usesLayout = /\{%-?\s*extends\s+(['"])neottia\.sdlc\.layout\1\s*-?%\}/u.test(template.content);
  const source = usesLayout
    ? `${template.content}\n${requiredTemplate(templates, SDLC_LAYOUT_TEMPLATE_ID).content}`
    : template.content;
  const outputTags = [...source.matchAll(/\{\{(-?)([\s\S]*?)(-?)\}\}/gu)].map((match) => match[2]!.trim());
  for (const path of [
    'instructions.issues',
    'instructions.documents',
    'instructions.sourceControl.local',
    'instructions.sourceControl.remote',
    'role.content',
  ]) {
    const references = outputTags.filter((tag) => tag.includes(path));
    const mentions = source.split(path).length - 1;
    if (mentions !== 1 || references.length !== 1 || references[0] !== path) {
      throw new TypeError(`Lifecycle template ${template.id} must output ${path} directly exactly once.`);
    }
  }
}

/** Finds one resolved template by stable ID. */
function requiredTemplate(templates: readonly ResolvedTemplate[], id: string): ResolvedTemplate {
  const matches = templates.filter((template) => template.id === id);
  if (matches.length !== 1) throw new TypeError(`Resolved lifecycle template ${id} is missing or duplicated.`);
  return matches[0]!;
}

/** Requires selected compiler provenance paths in deterministic order. */
function validateConfigurationProvenance(
  context: SdlcCompilerContext,
  provenance: readonly SdlcConfigurationProvenance[],
): void {
  if (canonicalJson(provenance.map((entry) => entry.path)) !== canonicalJson(configurationProvenancePaths(context))) {
    throw new TypeError('SDLC compiler configuration provenance is invalid.');
  }
}

/** Lists every selected configuration leaf that affects generated instructions. */
function configurationProvenancePaths(context: SdlcCompilerContext): readonly (readonly string[])[] {
  const paths: string[][] = [
    ['capabilities', 'issues', 'provider'],
    ['capabilities', 'documents', 'provider'],
    ['capabilities', 'source_control', 'local'],
    ['capabilities', 'source_control', 'remote'],
    ['capabilities', 'source_control', 'workspaces'],
  ];
  for (const forge of context.forges) {
    paths.push(['connections', 'forges', forge.provider, 'base_url']);
    paths.push(['connections', 'forges', forge.provider, 'credential_environment']);
    if (forge.allowInsecureHttp) paths.push(['connections', 'forges', forge.provider, 'allow_insecure_http']);
    for (const [key, service] of [
      ['issues', forge.mcp.issues],
      ['documents', forge.mcp.documents],
      ['remote_source_control', forge.mcp.remoteSourceControl],
    ] as const) {
      if (service === undefined) continue;
      paths.push(['connections', 'forges', forge.provider, 'mcp', key, 'server']);
      paths.push(['connections', 'forges', forge.provider, 'mcp', key, 'command']);
    }
  }
  return Object.freeze(paths.map((path) => Object.freeze(path)));
}

/** Checks template identity, provenance, dependencies, lifecycle data, and rendered fragments. */
function validateResolvedTemplates(
  templates: readonly ResolvedTemplate[],
  instructions: readonly SdlcInstructionPack[],
  roles: readonly SdlcRoleInstruction[],
): void {
  const expectedIds = [
    SDLC_CONTENT_TEMPLATE_ID,
    SDLC_LAYOUT_TEMPLATE_ID,
    ...SDLC_LIFECYCLE.map((command) => command.templateId),
  ].sort(compareCodeUnits);
  if (templates.length !== expectedIds.length) throw new TypeError('Resolved lifecycle templates are incomplete.');
  for (const [index, template] of templates.entries()) {
    if (template.id !== expectedIds[index])
      throw new TypeError('Resolved lifecycle templates are not in canonical order.');
    if (Buffer.byteLength(template.content, 'utf8') > MAX_TEMPLATE_BYTES) {
      throw new TypeError(`Resolved lifecycle template ${template.id} exceeds its byte limit.`);
    }
    if (checksumText(template.content) !== template.checksum) {
      throw new TypeError(`Resolved lifecycle template ${template.id} checksum does not match.`);
    }
  }
  validateTemplateDependencies(templates);
  const lifecycleContent = parseLifecycleContent(templates);
  const renderer = createTemplateRenderer(templates);
  const instructionText = Object.fromEntries(instructions.map((pack) => [pack.slot, pack.content])) as Record<
    SdlcInstructionPack['slot'],
    string
  >;
  for (const definition of SDLC_LIFECYCLE) {
    const template = requiredTemplate(templates, definition.templateId);
    validateTemplateFragmentReferences(template, templates);
    const templateRoles = createTemplateRoles(
      definition,
      roles.filter((role) => role.command === definition.id),
    );
    renderTrackedLifecycleTemplate(
      renderer,
      definition.templateId,
      definition,
      requiredLifecycleContent(lifecycleContent, definition.id),
      instructionText,
      templateRoles,
    );
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
    if (Buffer.byteLength(pack.content, 'utf8') > MAX_FRAGMENT_BYTES) {
      throw new TypeError(`Instruction pack ${pack.id} exceeds its byte limit.`);
    }
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
    if (Buffer.byteLength(role.content, 'utf8') > MAX_FRAGMENT_BYTES) {
      throw new TypeError(`Role instruction ${role.id} exceeds its byte limit.`);
    }
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
function configurationProvenance(
  snapshot: ResolvedConfigSnapshot,
  context: SdlcCompilerContext,
): readonly SdlcConfigurationProvenance[] {
  const fixedSources = [
    snapshot.sourceOf(issuesCapabilityConfigContribution, ['provider']),
    snapshot.sourceOf(documentsCapabilityConfigContribution, ['provider']),
    snapshot.sourceOf(sourceControlCapabilityConfigContribution, ['local']),
    snapshot.sourceOf(sourceControlCapabilityConfigContribution, ['remote']),
    snapshot.sourceOf(sourceControlCapabilityConfigContribution, ['workspaces']),
  ];
  const paths = configurationProvenancePaths(context);
  const forgeSources = paths
    .slice(fixedSources.length)
    .map((path) => snapshot.sourceOf(forgeConnectionsConfigContribution, path.slice(2)));
  return Object.freeze(
    paths.map((path, index) =>
      Object.freeze({
        path,
        source: portableProvenance([...fixedSources, ...forgeSources][index] ?? { kind: 'defaults' }),
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

/** Declares non-mutating prerequisite checks for selected forge integrations. */
function prerequisites(context: SdlcCompilerContext): readonly Prerequisite[] {
  const requirements = new Map<string, Prerequisite>();
  const add = (prerequisite: Prerequisite): void => {
    requirements.set(prerequisite.id, Object.freeze(prerequisite));
  };
  const addTool = (command: string, description: string, instructions: string): void => {
    add({
      id: `tool.${command}`,
      category: 'tool',
      description,
      check: Object.freeze({ kind: 'command', command }),
      instructions,
    });
  };

  addTool(
    context.sourceControl.local,
    `${context.sourceControl.local} source control`,
    `Install ${context.sourceControl.local} and make it available on PATH.`,
  );
  for (const forge of context.forges) {
    add({
      id: `forge.${forge.provider}.credential`,
      category: 'configuration',
      description: `${forge.provider} credential environment`,
      check: Object.freeze({ kind: 'environment', variable: forge.credentialEnvironment }),
      instructions: `Set ${forge.credentialEnvironment} to a credential accepted by the configured ${forge.provider} instance.`,
    });
    const needsGit =
      forge.capabilities.includes('remote-source-control') ||
      (forge.capabilities.includes('documents') && forge.mcp.documents === undefined);
    if (needsGit) addTool('git', 'Git for forge repository operations', 'Install Git and make it available on PATH.');
    const cli = FORGE_SUPPORT_DECLARATIONS[forge.provider].cli;
    const needsCli = forge.capabilities.some((capability) => {
      if (capability === 'documents') return false;
      if (capability === 'issues') return forge.mcp.issues === undefined;
      return forge.mcp.remoteSourceControl === undefined;
    });
    if (cli !== undefined && needsCli) {
      addTool(cli.command, `${forge.provider} command-line client`, `Install ${cli.command} from ${cli.documentation}`);
    }
    for (const service of [forge.mcp.issues, forge.mcp.documents, forge.mcp.remoteSourceControl]) {
      if (service === undefined) continue;
      add({
        id: `forge.${forge.provider}.mcp.${service.server}`,
        category: 'mcp-server',
        description: `${service.server} MCP server command`,
        check: Object.freeze({ kind: 'command', command: service.command }),
        instructions: `Install ${service.command}, register it as MCP server ${service.server}, and expose the required read and mutation operations.`,
      });
    }
  }
  return Object.freeze([...requirements.values()]);
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
