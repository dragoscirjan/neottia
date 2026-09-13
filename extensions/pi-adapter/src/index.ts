import {
  HOST_FEATURES,
  PACKAGE_VERSION_PATTERN,
  cloneFrozen,
  defineHarnessAdapter,
  defineHarnessDeclaration,
  invalidAssetId,
  invalidContent,
  projectSkillFile,
  projectionFailure,
  projectionSuccess,
  renderMarkdown,
  supportedFeature,
  targetPath,
  unsupportedFeature,
  unsupportedFeatureSupport,
  type AgentProjectionRequest,
  type ExtensionProjectionRequest,
  type HarnessAdapter,
  type HarnessScope,
  type HostConfigLocator,
  type HostConfigPlan,
  type HostConfigRequest,
  type HostFeature,
  type HostPackageDeclaration,
  type NeottiaRuntimePackageId,
  type PackageProjectionRequest,
  type ProjectedFile,
  type ProjectionDiagnostic,
  type ProjectionResult,
  type PromptProjectionRequest,
  type ReloadNotice,
  type ReloadRequest,
  type SkillProjectionRequest,
  type TargetPath,
  type TargetRequest,
} from '@neottia/harness-adapter';

/** Pi package names remain adapter-owned so callers use logical package ids. */
const PI_PACKAGE_NAMES: Readonly<Record<NeottiaRuntimePackageId, string>> = Object.freeze({
  memory: '@neottia/pi-memory',
  issues: '@neottia/pi-issues',
  'design-docs': '@neottia/pi-design-docs',
  searchable: '@neottia/pi-searchable',
});

/** Current Pi support, including explicit absence of native MCP and agents. */
export const piHarnessDeclaration = defineHarnessDeclaration({
  contractVersion: 1,
  id: 'pi',
  displayName: 'Pi',
  testedHostVersions: [],
  features: {
    'asset.prompt': supportedFeature('file'),
    'asset.skill': supportedFeature('file'),
    'asset.extension': supportedFeature('file'),
    'asset.agent': unsupportedFeatureSupport('Pi has no native agent asset.'),
    'config.package': supportedFeature('host-config'),
    'config.mcp.local': unsupportedFeatureSupport('Pi has no built-in MCP configuration.'),
    'config.mcp.remote': unsupportedFeatureSupport('Pi has no built-in MCP configuration.'),
    'prompt.description': supportedFeature('metadata'),
    'prompt.argument-hint': supportedFeature('metadata'),
    'prompt.agent': unsupportedFeatureSupport('Pi prompts cannot select a native agent.'),
    'prompt.model': unsupportedFeatureSupport('Pi prompt templates do not declare a model.'),
    'prompt.subtask': unsupportedFeatureSupport('Pi prompt templates do not declare subtask execution.'),
    'agent.primary': unsupportedFeatureSupport('Pi has no native agent asset.'),
    'agent.subagent': unsupportedFeatureSupport('Pi has no native agent asset.'),
    'agent.model': unsupportedFeatureSupport('Pi has no native agent asset.'),
    'agent.permissions': unsupportedFeatureSupport('Pi has no native agent asset.'),
    'agent.steps': unsupportedFeatureSupport('Pi has no native agent asset.'),
    'agent.thinking': unsupportedFeatureSupport('Pi has no portable agent thinking declaration.'),
  },
});

/** Pure declarative adapter for Pi assets and settings plans. */
export const piHarnessAdapter: HarnessAdapter = defineHarnessAdapter({
  declaration: piHarnessDeclaration,
  target: piTarget,
  projectPrompt: projectPiPrompt,
  projectSkill: projectPiSkill,
  projectExtension: projectPiExtension,
  projectAgent: projectPiAgent,
  declarePackage: declarePiPackage,
  planHostConfiguration: planPiHostConfiguration,
  reloadNotice: piReloadNotice,
});

/** Returns Pi paths without resolving a project or home directory. */
function piTarget(request: TargetRequest): ProjectionResult<TargetPath | HostConfigLocator> {
  const support = piHarnessDeclaration.features[request.feature];
  if (support.status === 'unsupported') {
    return projectionFailure([unsupportedFeature('pi', request.feature, request.scope, request.assetId)]);
  }
  if (!support.scopes.includes(request.scope))
    return projectionFailure([unsupportedScope(request.feature, request.scope)]);
  if (request.feature.startsWith('config.')) return projectionSuccess(piSettingsLocator(request.scope));
  if (request.assetId === undefined) return projectionFailure([assetIdRequired(request.feature, request.scope)]);
  const problem = invalidAssetId('pi', request.feature, request.scope, request.assetId);
  if (problem !== undefined) return projectionFailure([problem]);

  const base = request.scope === 'project' ? ['.pi'] : ['.pi', 'agent'];
  if (request.feature === 'asset.prompt')
    return projectionSuccess(targetPath(anchor(request.scope), [...base, 'prompts', `${request.assetId}.md`]));
  if (request.feature === 'asset.skill') {
    return projectionSuccess(targetPath(anchor(request.scope), [...base, 'skills', request.assetId, 'SKILL.md']));
  }
  return projectionSuccess(targetPath(anchor(request.scope), [...base, 'extensions', `${request.assetId}.ts`]));
}

/** Projects Pi prompt frontmatter and diagnoses unsupported execution metadata. */
function projectPiPrompt(request: PromptProjectionRequest): ProjectionResult<ProjectedFile> {
  const diagnostics = contentDiagnostics('asset.prompt', request.scope, request.id, request.body);
  const metadata = request.metadata ?? {};
  if (metadata.description !== undefined && !nonblank(metadata.description))
    diagnostics.push(invalidMetadata('prompt.description', request));
  if (metadata.argumentHint !== undefined && !nonblank(metadata.argumentHint))
    diagnostics.push(invalidMetadata('prompt.argument-hint', request));
  if (metadata.execution?.agent !== undefined) diagnostics.push(unrepresentable('prompt.agent', request));
  if (metadata.execution?.model !== undefined) diagnostics.push(unrepresentable('prompt.model', request));
  if (metadata.execution?.subtask !== undefined) diagnostics.push(unrepresentable('prompt.subtask', request));
  if (diagnostics.length > 0) return projectionFailure(diagnostics);

  const target = requirePath(piTarget({ feature: 'asset.prompt', scope: request.scope, assetId: request.id }));
  const entries: Array<readonly [string, string]> = [];
  if (metadata.description !== undefined) entries.push(['description', metadata.description]);
  if (metadata.argumentHint !== undefined) entries.push(['argument-hint', metadata.argumentHint]);
  return projectionSuccess({
    assetId: request.id,
    feature: 'asset.prompt' as const,
    target,
    mediaType: 'text/markdown' as const,
    content: entries.length === 0 ? request.body : renderMarkdown(entries, request.body),
  });
}

/** Projects a shared Agent Skills file to Pi's native path. */
function projectPiSkill(request: SkillProjectionRequest): ProjectionResult<ProjectedFile> {
  const target = piTarget({ feature: 'asset.skill', scope: request.scope, assetId: request.id });
  if (target.value === undefined) return projectionFailure(target.diagnostics);
  return projectSkillFile('pi', request, target.value as TargetPath);
}

/** Projects one local Pi extension source file. */
function projectPiExtension(request: ExtensionProjectionRequest): ProjectionResult<ProjectedFile> {
  const diagnostics = contentDiagnostics('asset.extension', request.scope, request.id, request.source);
  if (diagnostics.length > 0) return projectionFailure(diagnostics);
  return projectionSuccess({
    assetId: request.id,
    feature: 'asset.extension' as const,
    target: requirePath(piTarget({ feature: 'asset.extension', scope: request.scope, assetId: request.id })),
    mediaType: 'text/typescript' as const,
    content: request.source,
  });
}

/** Rejects agent output rather than emulating it with an extension. */
function projectPiAgent(request: AgentProjectionRequest): ProjectionResult<ProjectedFile> {
  return projectionFailure([unsupportedFeature('pi', 'asset.agent', request.scope, request.id)]);
}

/** Maps one logical Neottia module to its Pi package. */
function declarePiPackage(request: PackageProjectionRequest): ProjectionResult<HostPackageDeclaration> {
  const name = PI_PACKAGE_NAMES[request.logicalId];
  if (name === undefined || !PACKAGE_VERSION_PATTERN.test(request.version)) {
    return projectionFailure([invalidPackage(request.scope)]);
  }
  return projectionSuccess({
    logicalId: request.logicalId,
    scope: request.scope,
    source: { ecosystem: 'npm' as const, name, version: request.version },
    activation: 'pi-package' as const,
    provides: ['extension'] as const,
  });
}

/** Produces settings operations without parsing or replacing settings.json. */
function planPiHostConfiguration(request: HostConfigRequest): ProjectionResult<HostConfigPlan> {
  if (request.kind !== 'package') {
    const feature = request.kind === 'mcp.local' ? 'config.mcp.local' : 'config.mcp.remote';
    return projectionFailure([unsupportedFeature('pi', feature, request.scope, request.server.name)]);
  }
  const declaration = request.package;
  const expectedName = PI_PACKAGE_NAMES[declaration.logicalId];
  if (
    expectedName === undefined ||
    declaration.activation !== 'pi-package' ||
    declaration.source.ecosystem !== 'npm' ||
    declaration.source.name !== expectedName ||
    !PACKAGE_VERSION_PATTERN.test(declaration.source.version)
  ) {
    return projectionFailure([invalidPackage(declaration.scope)]);
  }
  return projectionSuccess({
    hostId: 'pi',
    scope: declaration.scope,
    target: piSettingsLocator(declaration.scope),
    operations: [
      {
        id: `package:${declaration.logicalId}`,
        kind: 'ensure-array-entry' as const,
        pointer: '/packages',
        identity: `npm:${declaration.source.name}`,
        value: `npm:${declaration.source.name}@${declaration.source.version}`,
        owner: 'neottia' as const,
      },
    ],
  });
}

/** Reports Pi's reload command or a restart for package activation. */
function piReloadNotice(request: ReloadRequest): ProjectionResult<ReloadNotice> {
  const affected = orderedFeatures(request.changedFeatures);
  const unsupportedFeatures = affected.filter(
    (feature) => piHarnessDeclaration.features[feature].status === 'unsupported',
  );
  if (unsupportedFeatures.length > 0) {
    return projectionFailure(unsupportedFeatures.map((feature) => unsupportedFeature('pi', feature)));
  }
  if (affected.length === 0) {
    return projectionSuccess({
      hostId: 'pi',
      action: 'none' as const,
      message: 'No Pi reload is needed.',
      affectedFeatures: [],
    });
  }
  if (affected.includes('config.package')) {
    return projectionSuccess({
      hostId: 'pi',
      action: 'restart' as const,
      message: 'Restart Pi so it can install and activate the configured package.',
      affectedFeatures: affected,
    });
  }
  return projectionSuccess({
    hostId: 'pi',
    action: 'command' as const,
    command: '/reload',
    message: 'Run /reload to refresh Pi resources.',
    affectedFeatures: affected,
  });
}

/** Returns Pi's one canonical settings path for the selected scope. */
function piSettingsLocator(scope: HarnessScope): HostConfigLocator {
  const path =
    scope === 'project'
      ? targetPath('project', ['.pi', 'settings.json'])
      : targetPath('home', ['.pi', 'agent', 'settings.json']);
  return cloneFrozen({ candidates: [path], createAt: path });
}

/** Selects the symbolic path anchor for Pi resources. */
function anchor(scope: HarnessScope): 'project' | 'home' {
  return scope === 'project' ? 'project' : 'home';
}

/** Collects path and content diagnostics before any projection output. */
function contentDiagnostics(
  feature: 'asset.prompt' | 'asset.extension',
  scope: HarnessScope,
  id: string,
  content: string,
): ProjectionDiagnostic[] {
  return [invalidAssetId('pi', feature, scope, id), invalidContent('pi', feature, scope, id, content)].filter(
    (problem): problem is ProjectionDiagnostic => problem !== undefined,
  );
}

/** Returns a typed diagnostic for a missing asset id. */
function assetIdRequired(feature: HostFeature, scope: HarnessScope): ProjectionDiagnostic {
  return {
    code: 'INVALID_ASSET_ID',
    hostId: 'pi',
    feature,
    scope,
    message: 'An asset id is required for this target.',
  };
}

/** Returns a typed scope diagnostic for future declaration changes. */
function unsupportedScope(feature: HostFeature, scope: HarnessScope): ProjectionDiagnostic {
  return { code: 'UNSUPPORTED_SCOPE', hostId: 'pi', feature, scope, message: 'The selected scope is not supported.' };
}

/** Returns a typed metadata representation diagnostic. */
function unrepresentable(feature: HostFeature, request: PromptProjectionRequest): ProjectionDiagnostic {
  return {
    code: 'UNREPRESENTABLE_METADATA',
    hostId: 'pi',
    feature,
    scope: request.scope,
    assetId: request.id,
    message: 'Pi cannot represent the requested prompt metadata.',
  };
}

/** Returns a typed malformed metadata diagnostic. */
function invalidMetadata(feature: HostFeature, request: PromptProjectionRequest): ProjectionDiagnostic {
  return {
    code: 'INVALID_CONTENT',
    hostId: 'pi',
    feature,
    scope: request.scope,
    assetId: request.id,
    message: 'Prompt metadata must be a non-empty string.',
  };
}

/** Returns a value-free package diagnostic. */
function invalidPackage(scope: HarnessScope): ProjectionDiagnostic {
  return {
    code: 'INVALID_PACKAGE_DECLARATION',
    hostId: 'pi',
    feature: 'config.package',
    scope,
    message: 'The package declaration is not valid for Pi.',
  };
}

/** Extracts a path from an already checked internal projection. */
function requirePath(result: ProjectionResult<TargetPath | HostConfigLocator>): TargetPath {
  if (result.value === undefined || 'candidates' in result.value)
    throw new TypeError('Expected a projected asset path.');
  return result.value;
}

/** Keeps reload feature ordering independent of caller order. */
function orderedFeatures(features: readonly HostFeature[]): readonly HostFeature[] {
  const selected = new Set(features);
  return Object.freeze(HOST_FEATURES.filter((feature) => selected.has(feature)));
}

/** Checks user-facing string metadata. */
function nonblank(value: string): boolean {
  return value.length > 0 && value.trim().length > 0;
}

export default piHarnessAdapter;
