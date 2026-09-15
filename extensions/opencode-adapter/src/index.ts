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
  sortRecord,
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
  type LocalMcpDeclaration,
  type NeottiaRuntimePackageId,
  type PackageProjectionRequest,
  type ProjectedFile,
  type ProjectionDiagnostic,
  type ProjectionResult,
  type PromptProjectionRequest,
  type ReloadNotice,
  type ReloadRequest,
  type RemoteMcpDeclaration,
  type SkillProjectionRequest,
  type TargetPath,
  type TargetRequest,
} from '@neottia/harness-adapter';

/** OpenCode package names remain private to the host adapter. */
const OPENCODE_PACKAGE_NAMES: Readonly<Record<NeottiaRuntimePackageId, string>> = Object.freeze({
  memory: '@neottia/opencode-memory',
  issues: '@neottia/opencode-issues',
  'design-docs': '@neottia/opencode-design-docs',
  searchable: '@neottia/opencode-searchable',
});

/** Current OpenCode asset, plugin, MCP, and agent support. */
export const opencodeHarnessDeclaration = defineHarnessDeclaration({
  contractVersion: 1,
  id: 'opencode',
  displayName: 'OpenCode',
  testedHostVersions: [],
  features: {
    'asset.prompt': supportedFeature('file'),
    'asset.skill': supportedFeature('file'),
    'asset.extension': supportedFeature('file'),
    'asset.agent': supportedFeature('file'),
    'config.package': supportedFeature('host-config'),
    'config.mcp.local': supportedFeature('host-config'),
    'config.mcp.remote': supportedFeature('host-config'),
    'prompt.description': supportedFeature('metadata'),
    'prompt.argument-hint': unsupportedFeatureSupport('OpenCode commands have no documented argument hint field.'),
    'prompt.agent': supportedFeature('metadata'),
    'prompt.model': supportedFeature('metadata'),
    'prompt.subtask': supportedFeature('metadata'),
    'agent.primary': supportedFeature('metadata'),
    'agent.subagent': supportedFeature('metadata'),
    'agent.model': supportedFeature('metadata'),
    'agent.permissions': supportedFeature('metadata'),
    'agent.steps': supportedFeature('metadata'),
    'agent.thinking': unsupportedFeatureSupport('OpenCode has no portable agent thinking field.'),
  },
});

/** Pure declarative adapter for OpenCode assets and configuration plans. */
export const opencodeHarnessAdapter: HarnessAdapter = defineHarnessAdapter({
  declaration: opencodeHarnessDeclaration,
  target: opencodeTarget,
  projectPrompt: projectOpencodePrompt,
  projectSkill: projectOpencodeSkill,
  projectExtension: projectOpencodeExtension,
  projectAgent: projectOpencodeAgent,
  declarePackage: declareOpencodePackage,
  planHostConfiguration: planOpencodeHostConfiguration,
  reloadNotice: opencodeReloadNotice,
});

/** Returns OpenCode paths without inspecting the filesystem or XDG variables. */
function opencodeTarget(request: TargetRequest): ProjectionResult<TargetPath | HostConfigLocator> {
  const support = opencodeHarnessDeclaration.features[request.feature];
  if (support.status === 'unsupported') {
    return projectionFailure([unsupportedFeature('opencode', request.feature, request.scope, request.assetId)]);
  }
  if (!support.scopes.includes(request.scope))
    return projectionFailure([unsupportedScope(request.feature, request.scope)]);
  if (request.feature.startsWith('config.')) return projectionSuccess(opencodeConfigLocator(request.scope));
  if (request.assetId === undefined) return projectionFailure([assetIdRequired(request.feature, request.scope)]);
  const problem = invalidAssetId('opencode', request.feature, request.scope, request.assetId);
  if (problem !== undefined) return projectionFailure([problem]);

  const base = request.scope === 'project' ? ['.opencode'] : ['opencode'];
  const anchor = request.scope === 'project' ? 'project' : 'xdg-config';
  if (request.feature === 'asset.prompt') {
    return projectionSuccess(targetPath(anchor, [...base, 'commands', `${request.assetId}.md`]));
  }
  if (request.feature === 'asset.skill') {
    return projectionSuccess(targetPath(anchor, [...base, 'skills', request.assetId, 'SKILL.md']));
  }
  if (request.feature === 'asset.extension') {
    return projectionSuccess(targetPath(anchor, [...base, 'plugins', `${request.assetId}.ts`]));
  }
  return projectionSuccess(targetPath(anchor, [...base, 'agents', `${request.assetId}.md`]));
}

/** Projects OpenCode command metadata without inventing an argument hint. */
function projectOpencodePrompt(request: PromptProjectionRequest): ProjectionResult<ProjectedFile> {
  const diagnostics = contentDiagnostics('asset.prompt', request.scope, request.id, request.body);
  const metadata = request.metadata ?? {};
  if (metadata.description !== undefined && !nonblank(metadata.description))
    diagnostics.push(invalidMetadata('prompt.description', request));
  if (metadata.argumentHint !== undefined) diagnostics.push(unrepresentable('prompt.argument-hint', request));
  if (metadata.execution?.agent !== undefined && !nonblank(metadata.execution.agent))
    diagnostics.push(invalidMetadata('prompt.agent', request));
  if (metadata.execution?.model !== undefined && !nonblank(metadata.execution.model))
    diagnostics.push(invalidMetadata('prompt.model', request));
  if (diagnostics.length > 0) return projectionFailure(diagnostics);

  const entries: Array<readonly [string, string | boolean]> = [];
  if (metadata.description !== undefined) entries.push(['description', metadata.description]);
  if (metadata.execution?.agent !== undefined) entries.push(['agent', metadata.execution.agent]);
  if (metadata.execution?.model !== undefined) entries.push(['model', metadata.execution.model]);
  if (metadata.execution?.subtask !== undefined) entries.push(['subtask', metadata.execution.subtask]);
  return projectionSuccess({
    assetId: request.id,
    feature: 'asset.prompt' as const,
    target: requirePath(opencodeTarget({ feature: 'asset.prompt', scope: request.scope, assetId: request.id })),
    mediaType: 'text/markdown' as const,
    content: entries.length === 0 ? request.body : renderMarkdown(entries, request.body),
  });
}

/** Projects one shared Agent Skills file to OpenCode's native directory. */
function projectOpencodeSkill(request: SkillProjectionRequest): ProjectionResult<ProjectedFile> {
  const target = opencodeTarget({ feature: 'asset.skill', scope: request.scope, assetId: request.id });
  if (target.value === undefined) return projectionFailure(target.diagnostics);
  return projectSkillFile('opencode', request, target.value as TargetPath);
}

/** Projects one local OpenCode plugin source file. */
function projectOpencodeExtension(request: ExtensionProjectionRequest): ProjectionResult<ProjectedFile> {
  const diagnostics = contentDiagnostics('asset.extension', request.scope, request.id, request.source);
  if (diagnostics.length > 0) return projectionFailure(diagnostics);
  return projectionSuccess({
    assetId: request.id,
    feature: 'asset.extension' as const,
    target: requirePath(opencodeTarget({ feature: 'asset.extension', scope: request.scope, assetId: request.id })),
    mediaType: 'text/typescript' as const,
    content: request.source,
  });
}

/** Projects a native OpenCode agent using current permission and steps fields. */
function projectOpencodeAgent(request: AgentProjectionRequest): ProjectionResult<ProjectedFile> {
  const diagnostics = contentDiagnostics('asset.agent', request.scope, request.id, request.body);
  if (!nonblank(request.description)) diagnostics.push(invalidAgentContent(request));
  if (request.modelHint !== undefined && !nonblank(request.modelHint)) diagnostics.push(invalidAgentContent(request));
  if (request.thinkingHint !== undefined) {
    diagnostics.push({
      code: 'UNREPRESENTABLE_METADATA',
      hostId: 'opencode',
      feature: 'agent.thinking',
      scope: request.scope,
      assetId: request.id,
      message: 'OpenCode cannot represent the requested portable thinking hint.',
    });
  }
  if (request.steps !== undefined && (!Number.isInteger(request.steps) || request.steps < 1))
    diagnostics.push(invalidAgentContent(request));
  if (
    request.permissions !== undefined &&
    Object.entries(request.permissions).some(
      ([key, value]) => !nonblank(key) || !['allow', 'ask', 'deny'].includes(value),
    )
  ) {
    diagnostics.push(invalidAgentContent(request));
  }
  if (diagnostics.length > 0) return projectionFailure(diagnostics);

  const entries: Array<readonly [string, string | number | Readonly<Record<string, string>>]> = [
    ['description', request.description],
    ['mode', request.mode],
  ];
  if (request.modelHint !== undefined) entries.push(['model', request.modelHint]);
  if (request.steps !== undefined) entries.push(['steps', request.steps]);
  if (request.permissions !== undefined) entries.push(['permission', sortRecord(request.permissions)]);
  return projectionSuccess({
    assetId: request.id,
    feature: 'asset.agent' as const,
    target: requirePath(opencodeTarget({ feature: 'asset.agent', scope: request.scope, assetId: request.id })),
    mediaType: 'text/markdown' as const,
    content: renderMarkdown(entries, request.body),
  });
}

/** Maps one logical Neottia module to its OpenCode plugin package. */
function declareOpencodePackage(request: PackageProjectionRequest): ProjectionResult<HostPackageDeclaration> {
  const name = OPENCODE_PACKAGE_NAMES[request.logicalId];
  if (name === undefined || !PACKAGE_VERSION_PATTERN.test(request.version)) {
    return projectionFailure([invalidPackage(request.scope)]);
  }
  return projectionSuccess({
    logicalId: request.logicalId,
    scope: request.scope,
    source: { ecosystem: 'npm' as const, name, version: request.version },
    activation: 'opencode-plugin' as const,
    provides: ['extension'] as const,
  });
}

/** Produces package or MCP operations without parsing opencode.json. */
function planOpencodeHostConfiguration(request: HostConfigRequest): ProjectionResult<HostConfigPlan> {
  if (request.kind === 'package') return planPackage(request.package);
  if (request.kind === 'mcp.local') return planLocalMcp(request.scope, request.server);
  return planRemoteMcp(request.scope, request.server);
}

/** Produces a conservative restart recommendation for changed OpenCode assets. */
function opencodeReloadNotice(request: ReloadRequest): ProjectionResult<ReloadNotice> {
  const affected = orderedFeatures(request.changedFeatures);
  const unsupportedFeatures = affected.filter(
    (feature) => opencodeHarnessDeclaration.features[feature].status === 'unsupported',
  );
  if (unsupportedFeatures.length > 0) {
    return projectionFailure(unsupportedFeatures.map((feature) => unsupportedFeature('opencode', feature)));
  }
  if (affected.length === 0) {
    return projectionSuccess({
      hostId: 'opencode',
      action: 'none' as const,
      message: 'No OpenCode restart is needed.',
      affectedFeatures: [],
    });
  }
  return projectionSuccess({
    hostId: 'opencode',
    action: 'restart' as const,
    message:
      'Restart OpenCode for deterministic pickup. This is Neottia adapter policy, not a universal host guarantee.',
    affectedFeatures: affected,
  });
}

/** Produces one plugin-array operation from a verified package declaration. */
function planPackage(declaration: HostPackageDeclaration): ProjectionResult<HostConfigPlan> {
  const expectedName = OPENCODE_PACKAGE_NAMES[declaration.logicalId];
  if (
    expectedName === undefined ||
    declaration.activation !== 'opencode-plugin' ||
    declaration.source.ecosystem !== 'npm' ||
    declaration.source.name !== expectedName ||
    !PACKAGE_VERSION_PATTERN.test(declaration.source.version)
  ) {
    return projectionFailure([invalidPackage(declaration.scope)]);
  }
  return projectionSuccess({
    hostId: 'opencode',
    scope: declaration.scope,
    target: opencodeConfigLocator(declaration.scope),
    operations: [
      {
        id: `package:${declaration.logicalId}`,
        kind: 'ensure-array-entry' as const,
        pointer: '/plugin',
        identity: `npm:${declaration.source.name}`,
        value: `${declaration.source.name}@${declaration.source.version}`,
        owner: 'neottia' as const,
      },
    ],
  });
}

/** Produces one local MCP object operation with the original argv boundaries. */
function planLocalMcp(scope: HarnessScope, server: LocalMcpDeclaration): ProjectionResult<HostConfigPlan> {
  const problem = validateLocalMcp(scope, server);
  if (problem !== undefined) return projectionFailure([problem]);
  const value = {
    type: 'local',
    command: [...server.command],
    ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
    ...(server.environment === undefined ? {} : { environment: sortRecord(server.environment) }),
    ...(server.enabled === undefined ? {} : { enabled: server.enabled }),
    ...(server.timeout === undefined ? {} : { timeout: server.timeout }),
  };
  return projectionSuccess(mcpPlan(scope, server.name, value));
}

/** Produces one remote MCP object operation without resolving header references. */
function planRemoteMcp(scope: HarnessScope, server: RemoteMcpDeclaration): ProjectionResult<HostConfigPlan> {
  const problem = validateRemoteMcp(scope, server);
  if (problem !== undefined) return projectionFailure([problem]);
  const value = {
    type: 'remote',
    url: server.url,
    ...(server.headers === undefined ? {} : { headers: sortRecord(server.headers) }),
    ...(server.oauth === undefined ? {} : { oauth: server.oauth }),
    ...(server.enabled === undefined ? {} : { enabled: server.enabled }),
    ...(server.timeout === undefined ? {} : { timeout: server.timeout }),
  };
  return projectionSuccess(mcpPlan(scope, server.name, value));
}

/** Wraps one MCP server in an ownership-aware object-entry operation. */
function mcpPlan(scope: HarnessScope, name: string, value: Record<string, unknown>): HostConfigPlan {
  return cloneFrozen({
    hostId: 'opencode',
    scope,
    target: opencodeConfigLocator(scope),
    operations: [
      {
        id: `mcp:${name}`,
        kind: 'ensure-object-entry' as const,
        pointer: '/mcp',
        key: name,
        value,
        owner: 'neottia' as const,
      },
    ],
  });
}

/** Returns OpenCode's JSON/JSONC candidates and canonical creation path. */
function opencodeConfigLocator(scope: HarnessScope): HostConfigLocator {
  const anchor = scope === 'project' ? 'project' : 'xdg-config';
  const base = scope === 'project' ? [] : ['opencode'];
  const json = targetPath(anchor, [...base, 'opencode.json']);
  const jsonc = targetPath(anchor, [...base, 'opencode.jsonc']);
  return cloneFrozen({ candidates: [json, jsonc], createAt: json });
}

/** Collects path and content diagnostics before any projection output. */
function contentDiagnostics(
  feature: 'asset.prompt' | 'asset.extension' | 'asset.agent',
  scope: HarnessScope,
  id: string,
  content: string,
): ProjectionDiagnostic[] {
  return [
    invalidAssetId('opencode', feature, scope, id),
    invalidContent('opencode', feature, scope, id, content),
  ].filter((problem): problem is ProjectionDiagnostic => problem !== undefined);
}

/** Validates a local MCP declaration without returning rejected values. */
function validateLocalMcp(scope: HarnessScope, server: LocalMcpDeclaration): ProjectionDiagnostic | undefined {
  const validCommand =
    Array.isArray(server.command) &&
    server.command.length > 0 &&
    server.command.every((part) => nonblank(part) && safeText(part));
  const validEnvironment =
    server.environment === undefined ||
    Object.entries(server.environment).every(([key, value]) => nonblank(key) && safeText(key) && safeText(value));
  const validCwd = server.cwd === undefined || (nonblank(server.cwd) && safeText(server.cwd));
  if (
    invalidAssetId('opencode', 'config.mcp.local', scope, server.name) === undefined &&
    validCommand &&
    validEnvironment &&
    validCwd &&
    validTimeout(server.timeout)
  ) {
    return undefined;
  }
  return invalidMcp('config.mcp.local', scope);
}

/** Validates remote MCP transport without exposing headers over plaintext HTTP. */
function validateRemoteMcp(scope: HarnessScope, server: RemoteMcpDeclaration): ProjectionDiagnostic | undefined {
  let protocol: string | undefined;
  try {
    protocol = new URL(server.url).protocol;
  } catch {
    protocol = undefined;
  }
  const validHeaders =
    server.headers === undefined ||
    Object.entries(server.headers).every(([key, value]) => nonblank(key) && safeText(key) && safeText(value));
  const secureHeaders = server.headers === undefined || protocol === 'https:';
  if (
    invalidAssetId('opencode', 'config.mcp.remote', scope, server.name) === undefined &&
    (protocol === 'http:' || protocol === 'https:') &&
    validHeaders &&
    secureHeaders &&
    (server.oauth === undefined || server.oauth === false) &&
    validTimeout(server.timeout)
  ) {
    return undefined;
  }
  return invalidMcp('config.mcp.remote', scope);
}

/** Returns a typed diagnostic for a missing asset id. */
function assetIdRequired(feature: HostFeature, scope: HarnessScope): ProjectionDiagnostic {
  return {
    code: 'INVALID_ASSET_ID',
    hostId: 'opencode',
    feature,
    scope,
    message: 'An asset id is required for this target.',
  };
}

/** Returns a typed scope diagnostic for future declaration changes. */
function unsupportedScope(feature: HostFeature, scope: HarnessScope): ProjectionDiagnostic {
  return {
    code: 'UNSUPPORTED_SCOPE',
    hostId: 'opencode',
    feature,
    scope,
    message: 'The selected scope is not supported.',
  };
}

/** Returns a typed metadata representation diagnostic. */
function unrepresentable(feature: HostFeature, request: PromptProjectionRequest): ProjectionDiagnostic {
  return {
    code: 'UNREPRESENTABLE_METADATA',
    hostId: 'opencode',
    feature,
    scope: request.scope,
    assetId: request.id,
    message: 'OpenCode cannot represent the requested prompt metadata.',
  };
}

/** Returns a typed malformed prompt metadata diagnostic. */
function invalidMetadata(feature: HostFeature, request: PromptProjectionRequest): ProjectionDiagnostic {
  return {
    code: 'INVALID_CONTENT',
    hostId: 'opencode',
    feature,
    scope: request.scope,
    assetId: request.id,
    message: 'Prompt metadata must be a non-empty string.',
  };
}

/** Returns one value-free invalid agent diagnostic. */
function invalidAgentContent(request: AgentProjectionRequest): ProjectionDiagnostic {
  return {
    code: 'INVALID_CONTENT',
    hostId: 'opencode',
    feature: 'asset.agent',
    scope: request.scope,
    assetId: request.id,
    message: 'The agent declaration contains invalid metadata.',
  };
}

/** Returns one value-free package diagnostic. */
function invalidPackage(scope: HarnessScope): ProjectionDiagnostic {
  return {
    code: 'INVALID_PACKAGE_DECLARATION',
    hostId: 'opencode',
    feature: 'config.package',
    scope,
    message: 'The package declaration is not valid for OpenCode.',
  };
}

/** Returns one value-free MCP diagnostic. */
function invalidMcp(feature: 'config.mcp.local' | 'config.mcp.remote', scope: HarnessScope): ProjectionDiagnostic {
  return {
    code: 'INVALID_MCP_DECLARATION',
    hostId: 'opencode',
    feature,
    scope,
    message: 'The MCP declaration is not valid for OpenCode.',
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

/** Checks string metadata without changing accepted bytes. */
function nonblank(value: string): boolean {
  return value.length > 0 && value.trim().length > 0;
}

/** Rejects line breaks and NUL characters in scalar host configuration values. */
function safeText(value: string): boolean {
  return !value.includes('\0') && !value.includes('\r') && !value.includes('\n');
}

/** Validates optional OpenCode timeout values. */
function validTimeout(timeout: number | undefined): boolean {
  return timeout === undefined || (Number.isInteger(timeout) && timeout > 0);
}

export default opencodeHarnessAdapter;
