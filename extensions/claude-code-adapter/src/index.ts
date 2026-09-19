import {
  cloneFrozen,
  defineHarnessAdapter,
  defineHarnessDeclaration,
  invalidAssetId,
  invalidContent,
  nonblank,
  orderHostFeatures as orderedFeatures,
  projectSkillFile,
  projectionFailure,
  projectionSuccess,
  renderMarkdown,
  requireProjectedPath as requirePath,
  sortRecord,
  supportedFeature,
  targetPath,
  unsupportedFeature,
  unsupportedFeatureSupport,
  validLocalMcp,
  validRemoteMcp,
  type AgentProjectionRequest,
  type ExtensionProjectionRequest,
  type FeatureSupport,
  type HarnessAdapter,
  type HarnessScope,
  type HostConfigLocator,
  type HostConfigPlan,
  type HostConfigRequest,
  type HostFeature,
  type HostPackageDeclaration,
  type LocalMcpDeclaration,
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

const CLAUDE_CODE_ID = 'claude-code';
const CLAUDE_CODE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const PROJECT_CONFIG_SUPPORT: FeatureSupport = Object.freeze({
  status: 'supported',
  scopes: Object.freeze(['project'] as const),
  projection: 'host-config',
});

/** Current Claude Code command, skill, agent, and project MCP support. */
export const claudeCodeHarnessDeclaration = defineHarnessDeclaration({
  contractVersion: 1,
  id: CLAUDE_CODE_ID,
  displayName: 'Claude Code',
  testedHostVersions: [],
  features: {
    'asset.prompt': supportedFeature('file'),
    'asset.skill': supportedFeature('file'),
    'asset.extension': unsupportedFeatureSupport('Claude Code plugins require multi-file plugin packages.'),
    'asset.agent': supportedFeature('file'),
    'config.package': unsupportedFeatureSupport('Neottia does not publish Claude Code runtime plugin packages.'),
    'config.mcp.local': PROJECT_CONFIG_SUPPORT,
    'config.mcp.remote': PROJECT_CONFIG_SUPPORT,
    'prompt.description': supportedFeature('metadata'),
    'prompt.argument-hint': supportedFeature('metadata'),
    'prompt.agent': supportedFeature('metadata'),
    'prompt.model': supportedFeature('metadata'),
    'prompt.subtask': supportedFeature('metadata'),
    'agent.primary': supportedFeature('metadata'),
    'agent.subagent': supportedFeature('metadata'),
    'agent.model': supportedFeature('metadata'),
    'agent.permissions': unsupportedFeatureSupport('Claude Code has no portable per-tool allow, ask, and deny map.'),
    'agent.steps': supportedFeature('metadata'),
    'agent.thinking': supportedFeature('metadata'),
  },
});

/** Pure declarative adapter for Claude Code assets and project MCP plans. */
export const claudeCodeHarnessAdapter: HarnessAdapter = defineHarnessAdapter({
  declaration: claudeCodeHarnessDeclaration,
  target: claudeCodeTarget,
  projectPrompt: projectClaudeCodePrompt,
  projectSkill: projectClaudeCodeSkill,
  projectExtension: projectClaudeCodeExtension,
  projectAgent: projectClaudeCodeAgent,
  declarePackage: declareClaudeCodePackage,
  planHostConfiguration: planClaudeCodeHostConfiguration,
  reloadNotice: claudeCodeReloadNotice,
});

/** Returns documented Claude Code project and user paths without filesystem access. */
function claudeCodeTarget(request: TargetRequest): ProjectionResult<TargetPath | HostConfigLocator> {
  const support = claudeCodeHarnessDeclaration.features[request.feature];
  if (support.status === 'unsupported') {
    return projectionFailure([unsupportedFeature(CLAUDE_CODE_ID, request.feature, request.scope, request.assetId)]);
  }
  if (!support.scopes.includes(request.scope)) {
    return projectionFailure([unsupportedScope(request.feature, request.scope)]);
  }
  if (request.feature.startsWith('config.')) return projectionSuccess(claudeCodeMcpLocator());
  if (request.assetId === undefined) return projectionFailure([assetIdRequired(request.feature, request.scope)]);
  const problem = invalidAssetId(CLAUDE_CODE_ID, request.feature, request.scope, request.assetId);
  if (problem !== undefined) return projectionFailure([problem]);

  const base = ['.claude'];
  const anchor = request.scope === 'project' ? 'project' : 'home';
  if (request.feature === 'asset.prompt') {
    return projectionSuccess(targetPath(anchor, [...base, 'commands', `${request.assetId}.md`]));
  }
  if (request.feature === 'asset.skill') {
    return projectionSuccess(targetPath(anchor, [...base, 'skills', request.assetId, 'SKILL.md']));
  }
  return projectionSuccess(targetPath(anchor, [...base, 'agents', `${request.assetId}.md`]));
}

/** Projects current Claude Code command frontmatter, including fork routing. */
function projectClaudeCodePrompt(request: PromptProjectionRequest): ProjectionResult<ProjectedFile> {
  const diagnostics = contentDiagnostics('asset.prompt', request.scope, request.id, request.body);
  const metadata = request.metadata ?? {};
  if (metadata.description !== undefined && !nonblank(metadata.description)) {
    diagnostics.push(invalidPromptMetadata('prompt.description', request));
  }
  if (metadata.argumentHint !== undefined && !nonblank(metadata.argumentHint)) {
    diagnostics.push(invalidPromptMetadata('prompt.argument-hint', request));
  }
  if (metadata.execution?.agent !== undefined && !nonblank(metadata.execution.agent)) {
    diagnostics.push(invalidPromptMetadata('prompt.agent', request));
  }
  if (metadata.execution?.model !== undefined && !nonblank(metadata.execution.model)) {
    diagnostics.push(invalidPromptMetadata('prompt.model', request));
  }
  if (diagnostics.length > 0) return projectionFailure(diagnostics);

  const entries: Array<readonly [string, string | boolean]> = [];
  if (metadata.description !== undefined) entries.push(['description', metadata.description]);
  if (metadata.argumentHint !== undefined) entries.push(['argument-hint', metadata.argumentHint]);
  if (metadata.execution?.model !== undefined) entries.push(['model', metadata.execution.model]);
  // Claude Code forks the command into a subagent when context is set. An explicit
  // agent selection implies the fork; a portable subtask request maps to fork alone.
  if (metadata.execution?.agent !== undefined || metadata.execution?.subtask === true) {
    entries.push(['context', 'fork']);
  }
  if (metadata.execution?.agent !== undefined) entries.push(['agent', metadata.execution.agent]);
  return projectionSuccess({
    assetId: request.id,
    feature: 'asset.prompt' as const,
    target: requirePath(claudeCodeTarget({ feature: 'asset.prompt', scope: request.scope, assetId: request.id })),
    mediaType: 'text/markdown' as const,
    content: entries.length === 0 ? request.body : renderMarkdown(entries, request.body),
  });
}

/** Projects a shared Agent Skills file to Claude Code's native directory. */
function projectClaudeCodeSkill(request: SkillProjectionRequest): ProjectionResult<ProjectedFile> {
  const target = claudeCodeTarget({ feature: 'asset.skill', scope: request.scope, assetId: request.id });
  if (target.value === undefined) return projectionFailure(target.diagnostics);
  return projectSkillFile(CLAUDE_CODE_ID, request, target.value as TargetPath);
}

/** Rejects single-file extension requests because Claude plugins are directories. */
function projectClaudeCodeExtension(request: ExtensionProjectionRequest): ProjectionResult<ProjectedFile> {
  return projectionFailure([unsupportedFeature(CLAUDE_CODE_ID, 'asset.extension', request.scope, request.id)]);
}

/** Projects Claude Code custom agents with bounded portable metadata. */
function projectClaudeCodeAgent(request: AgentProjectionRequest): ProjectionResult<ProjectedFile> {
  const diagnostics = contentDiagnostics('asset.agent', request.scope, request.id, request.body);
  if (!nonblank(request.description)) diagnostics.push(invalidAgentContent(request));
  if (request.modelHint !== undefined && !nonblank(request.modelHint)) diagnostics.push(invalidAgentContent(request));
  if (request.thinkingHint !== undefined && !CLAUDE_CODE_EFFORTS.has(request.thinkingHint)) {
    diagnostics.push(unrepresentableAgent('agent.thinking', request));
  }
  if (request.steps !== undefined && (!Number.isInteger(request.steps) || request.steps < 1)) {
    diagnostics.push(invalidAgentContent(request));
  }
  if (request.permissions !== undefined) diagnostics.push(unrepresentableAgent('agent.permissions', request));
  if (diagnostics.length > 0) return projectionFailure(diagnostics);

  const entries: Array<readonly [string, string | number]> = [
    ['name', request.id],
    ['description', request.description],
  ];
  if (request.modelHint !== undefined) entries.push(['model', request.modelHint]);
  if (request.thinkingHint !== undefined) entries.push(['effort', request.thinkingHint]);
  if (request.steps !== undefined) entries.push(['maxTurns', request.steps]);
  return projectionSuccess({
    assetId: request.id,
    feature: 'asset.agent' as const,
    target: requirePath(claudeCodeTarget({ feature: 'asset.agent', scope: request.scope, assetId: request.id })),
    mediaType: 'text/markdown' as const,
    content: renderMarkdown(entries, request.body),
  });
}

/** Rejects runtime package declarations until Neottia ships Claude plugins. */
function declareClaudeCodePackage(request: PackageProjectionRequest): ProjectionResult<HostPackageDeclaration> {
  return projectionFailure([unsupportedFeature(CLAUDE_CODE_ID, 'config.package', request.scope, request.logicalId)]);
}

/** Produces project-scoped .mcp.json operations without editing user-managed state. */
function planClaudeCodeHostConfiguration(request: HostConfigRequest): ProjectionResult<HostConfigPlan> {
  if (request.kind === 'package') {
    return projectionFailure([
      unsupportedFeature(CLAUDE_CODE_ID, 'config.package', request.package.scope, request.package.logicalId),
    ]);
  }
  if (request.scope !== 'project') {
    return projectionFailure([unsupportedScope(configFeature(request.kind), request.scope)]);
  }
  if (request.kind === 'mcp.local') return planLocalMcp(request.server);
  return planRemoteMcp(request.server);
}

/** Returns a conservative restart recommendation for changed Claude Code assets. */
function claudeCodeReloadNotice(request: ReloadRequest): ProjectionResult<ReloadNotice> {
  const affected = orderedFeatures(request.changedFeatures);
  const unsupportedFeatures = affected.filter(
    (feature) => claudeCodeHarnessDeclaration.features[feature].status === 'unsupported',
  );
  if (unsupportedFeatures.length > 0) {
    return projectionFailure(unsupportedFeatures.map((feature) => unsupportedFeature(CLAUDE_CODE_ID, feature)));
  }
  if (affected.length === 0) {
    return projectionSuccess({
      hostId: CLAUDE_CODE_ID,
      action: 'none' as const,
      message: 'No Claude Code restart is needed.',
      affectedFeatures: [],
    });
  }
  return projectionSuccess({
    hostId: CLAUDE_CODE_ID,
    action: 'restart' as const,
    message: 'Restart Claude Code so commands, agents, and MCP configuration are loaded consistently.',
    affectedFeatures: affected,
  });
}

/** Produces one Claude stdio server entry with argv boundaries preserved. */
function planLocalMcp(server: LocalMcpDeclaration): ProjectionResult<HostConfigPlan> {
  const problem = validateLocalMcp(server);
  if (problem !== undefined) return projectionFailure([problem]);
  const value = {
    type: 'stdio',
    command: server.command[0],
    ...(server.command.length === 1 ? {} : { args: server.command.slice(1) }),
    ...(server.environment === undefined ? {} : { env: sortRecord(server.environment) }),
    ...(server.timeout === undefined ? {} : { timeout: server.timeout }),
  };
  return projectionSuccess(mcpPlan(server.name, value));
}

/** Produces one Claude HTTP server entry without resolving header references. */
function planRemoteMcp(server: RemoteMcpDeclaration): ProjectionResult<HostConfigPlan> {
  const problem = validateRemoteMcp(server);
  if (problem !== undefined) return projectionFailure([problem]);
  const value = {
    type: 'http',
    url: server.url,
    ...(server.headers === undefined ? {} : { headers: sortRecord(server.headers) }),
    ...(server.timeout === undefined ? {} : { timeout: server.timeout }),
  };
  return projectionSuccess(mcpPlan(server.name, value));
}

/** Wraps one MCP server in an ownership-aware object-entry operation. */
function mcpPlan(name: string, value: Record<string, unknown>): HostConfigPlan {
  return cloneFrozen({
    hostId: CLAUDE_CODE_ID,
    scope: 'project' as const,
    target: claudeCodeMcpLocator(),
    operations: [
      {
        id: `mcp:${name}`,
        kind: 'ensure-object-entry' as const,
        pointer: '/mcpServers',
        key: name,
        value,
        owner: 'neottia' as const,
      },
    ],
  });
}

/** Returns the committed project MCP file accepted by Claude Code. */
function claudeCodeMcpLocator(): HostConfigLocator {
  const path = targetPath('project', ['.mcp.json']);
  return cloneFrozen({ candidates: [path], createAt: path });
}

/** Collects path and content diagnostics before projection. */
function contentDiagnostics(
  feature: 'asset.prompt' | 'asset.agent',
  scope: HarnessScope,
  id: string,
  content: string,
): ProjectionDiagnostic[] {
  return [
    invalidAssetId(CLAUDE_CODE_ID, feature, scope, id),
    invalidContent(CLAUDE_CODE_ID, feature, scope, id, content),
  ].filter((problem): problem is ProjectionDiagnostic => problem !== undefined);
}

/** Validates the subset of Claude stdio configuration represented by the contract. */
function validateLocalMcp(server: LocalMcpDeclaration): ProjectionDiagnostic | undefined {
  return validLocalMcp(CLAUDE_CODE_ID, 'project', server, {
    allowCwd: false,
    allowEnabled: false,
    validTimeout,
  })
    ? undefined
    : invalidMcp('config.mcp.local');
}

/** Validates HTTP MCP configuration and prevents headers over plaintext transport. */
function validateRemoteMcp(server: RemoteMcpDeclaration): ProjectionDiagnostic | undefined {
  return validRemoteMcp(CLAUDE_CODE_ID, 'project', server, {
    allowOauthFalse: false,
    allowEnabled: false,
    validTimeout,
  })
    ? undefined
    : invalidMcp('config.mcp.remote');
}

/** Maps one host-config request kind to its declared feature. */
function configFeature(kind: 'mcp.local' | 'mcp.remote'): HostFeature {
  return kind === 'mcp.local' ? 'config.mcp.local' : 'config.mcp.remote';
}

/** Returns a typed diagnostic for a missing asset id. */
function assetIdRequired(feature: HostFeature, scope: HarnessScope): ProjectionDiagnostic {
  return {
    code: 'INVALID_ASSET_ID',
    hostId: CLAUDE_CODE_ID,
    feature,
    scope,
    message: 'An asset id is required for this target.',
  };
}

/** Returns a typed scope diagnostic for project-only configuration. */
function unsupportedScope(feature: HostFeature, scope: HarnessScope): ProjectionDiagnostic {
  return {
    code: 'UNSUPPORTED_SCOPE',
    hostId: CLAUDE_CODE_ID,
    feature,
    scope,
    message: 'Claude Code supports this operation only in the declared scope.',
  };
}

/** Returns a malformed prompt metadata diagnostic. */
function invalidPromptMetadata(feature: HostFeature, request: PromptProjectionRequest): ProjectionDiagnostic {
  return {
    code: 'INVALID_CONTENT',
    hostId: CLAUDE_CODE_ID,
    feature,
    scope: request.scope,
    assetId: request.id,
    message: 'Prompt metadata must be a non-empty string.',
  };
}

/** Returns an agent metadata diagnostic without copying rejected values. */
function unrepresentableAgent(feature: HostFeature, request: AgentProjectionRequest): ProjectionDiagnostic {
  return {
    code: 'UNREPRESENTABLE_METADATA',
    hostId: CLAUDE_CODE_ID,
    feature,
    scope: request.scope,
    assetId: request.id,
    message: 'Claude Code cannot represent the requested portable agent metadata.',
  };
}

/** Returns one value-free invalid agent diagnostic. */
function invalidAgentContent(request: AgentProjectionRequest): ProjectionDiagnostic {
  return {
    code: 'INVALID_CONTENT',
    hostId: CLAUDE_CODE_ID,
    feature: 'asset.agent',
    scope: request.scope,
    assetId: request.id,
    message: 'The Claude Code agent declaration contains invalid metadata.',
  };
}

/** Returns one value-free invalid MCP diagnostic. */
function invalidMcp(feature: 'config.mcp.local' | 'config.mcp.remote'): ProjectionDiagnostic {
  return {
    code: 'INVALID_MCP_DECLARATION',
    hostId: CLAUDE_CODE_ID,
    feature,
    scope: 'project',
    message: 'The MCP declaration is not valid for Claude Code project configuration.',
  };
}

/** Validates the documented per-server timeout lower bound. */
function validTimeout(timeout: number | undefined): boolean {
  return timeout === undefined || (Number.isInteger(timeout) && timeout >= 1000);
}

export default claudeCodeHarnessAdapter;
