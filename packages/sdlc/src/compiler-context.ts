import type { ResolvedConfigSnapshot } from '@neottia/config';
import { designDocsConfigContribution } from '@neottia/design-docs';
import { canonicalJson, compareCodeUnits } from '@neottia/distribution';
import { issueConfigContribution } from '@neottia/issues';
import {
  documentsCapabilityConfigContribution,
  issuesCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
  type DocumentProvider,
  type IssueProvider,
  type LocalSourceControlProvider,
  type RemoteSourceControlProvider,
} from './config.js';
import { forgeConnectionsConfigContribution, type ForgeMcpConfig, type ForgeMcpService } from './forge-config.js';
import {
  FORGE_SUPPORT_DECLARATIONS,
  isForgeProvider,
  type ForgeCapability,
  type ForgeProvider,
} from './forge-support.js';

/** Stable causes for rejecting a resolved SDLC compiler context. */
export type SdlcConfigProblemCode =
  | 'DOCUMENTS_MODULE_DISABLED'
  | 'FORGE_CAPABILITY_UNSUPPORTED'
  | 'FORGE_CONNECTION_REQUIRED'
  | 'FORGE_INSECURE_HTTP_REQUIRES_OPT_IN'
  | 'FORGE_MCP_REQUIRED'
  | 'ISSUES_MODULE_DISABLED'
  | 'WORKSPACES_REQUIRE_GIT';

/** One value-free semantic configuration problem. */
export interface SdlcConfigProblem {
  readonly code: SdlcConfigProblemCode;
  readonly path: readonly string[];
  readonly message: string;
}

/** Reports semantic conflicts between independently valid configuration shards. */
export class SdlcConfigError extends Error {
  readonly code = 'SDLC_CONFIG_INVALID';
  readonly problems: readonly SdlcConfigProblem[];

  constructor(problems: readonly SdlcConfigProblem[]) {
    const ordered = [...problems].sort(compareProblems).map(freezeProblem);
    super(`Invalid SDLC configuration: ${ordered.map((problem) => problem.message).join('; ')}`);
    this.name = 'SdlcConfigError';
    this.problems = Object.freeze(ordered);
  }
}

/** Selected command-backed MCP services exposed to generated instructions. */
export interface SdlcForgeMcpContext {
  readonly issues?: ForgeMcpService;
  readonly documents?: ForgeMcpService;
  readonly remoteSourceControl?: ForgeMcpService;
}

/** One selected forge connection included in deterministic compiler input. */
export interface SdlcForgeConnectionContext {
  readonly provider: ForgeProvider;
  readonly capabilities: readonly ForgeCapability[];
  readonly baseUrl: string;
  readonly credentialEnvironment: string;
  readonly allowInsecureHttp: boolean;
  readonly mcp: SdlcForgeMcpContext;
}

/** Provider selections and selected forge connections consumed by the prompt compiler. */
export interface SdlcCompilerContext {
  readonly issues: { readonly provider: IssueProvider };
  readonly documents: { readonly provider: DocumentProvider };
  readonly sourceControl: {
    readonly local: LocalSourceControlProvider;
    readonly remote:
      { readonly enabled: false } | { readonly enabled: true; readonly provider: RemoteSourceControlProvider };
    readonly workspaces: boolean;
  };
  readonly forges: readonly SdlcForgeConnectionContext[];
}

/** Builds immutable prompt-compiler input from one already resolved snapshot. */
export function createSdlcCompilerContext(snapshot: ResolvedConfigSnapshot): SdlcCompilerContext {
  const issues = snapshot.get(issuesCapabilityConfigContribution);
  const documents = snapshot.get(documentsCapabilityConfigContribution);
  const sourceControl = snapshot.get(sourceControlCapabilityConfigContribution);
  const connections = snapshot.get(forgeConnectionsConfigContribution);
  const selected = selectedForgeCapabilities(issues.provider, documents.provider, sourceControl.remote);
  const problems: SdlcConfigProblem[] = [];

  if (issues.provider === 'filesystem' && !snapshot.get(issueConfigContribution).enabled) {
    problems.push({
      code: 'ISSUES_MODULE_DISABLED',
      path: ['modules', 'issues', 'enabled'],
      message: 'The Issues module must be enabled for the selected authority.',
    });
  }
  if (documents.provider === 'filesystem' && !snapshot.get(designDocsConfigContribution).enabled) {
    problems.push({
      code: 'DOCUMENTS_MODULE_DISABLED',
      path: ['modules', 'design_docs', 'enabled'],
      message: 'The Design Docs module must be enabled for the selected authority.',
    });
  }
  if (sourceControl.workspaces && sourceControl.local !== 'git') {
    problems.push({
      code: 'WORKSPACES_REQUIRE_GIT',
      path: ['capabilities', 'source_control', 'workspaces'],
      message: 'Workspaces are incompatible with the selected local source-control implementation.',
    });
  }
  for (const selection of selected) {
    const connection = connections[selection.provider];
    if (connection === undefined) {
      problems.push({
        code: 'FORGE_CONNECTION_REQUIRED',
        path: ['connections', 'forges', selection.provider],
        message: 'A selected forge requires an explicit connection.',
      });
      continue;
    }
    const support = FORGE_SUPPORT_DECLARATIONS[selection.provider];
    if (connection.base_url.toLowerCase().startsWith('http://') && connection.allow_insecure_http !== true) {
      problems.push({
        code: 'FORGE_INSECURE_HTTP_REQUIRES_OPT_IN',
        path: ['connections', 'forges', selection.provider, 'allow_insecure_http'],
        message: 'An HTTP forge connection requires explicit insecure-transport opt-in.',
      });
    }
    for (const capability of selection.capabilities) {
      if (!support.capabilities.includes(capability)) {
        problems.push({
          code: 'FORGE_CAPABILITY_UNSUPPORTED',
          path: capabilitySelectionPath(capability),
          message: 'The selected forge does not support this capability.',
        });
      } else if (
        support.mcpRequiredFor.includes(capability) &&
        mcpForCapability(connection.mcp, capability) === undefined
      ) {
        problems.push({
          code: 'FORGE_MCP_REQUIRED',
          path: ['connections', 'forges', selection.provider, 'mcp', mcpConfigKey(capability)],
          message: 'The selected forge capability requires an explicit MCP service.',
        });
      }
    }
  }
  if (problems.length > 0) throw new SdlcConfigError(problems);

  const remote =
    sourceControl.remote === false
      ? Object.freeze({ enabled: false as const })
      : Object.freeze({ enabled: true as const, provider: sourceControl.remote });
  const forges = selected.map((selection) => {
    const connection = connections[selection.provider]!;
    return Object.freeze({
      provider: selection.provider,
      capabilities: selection.capabilities,
      baseUrl: connection.base_url,
      credentialEnvironment: connection.credential_environment,
      allowInsecureHttp: connection.allow_insecure_http === true,
      mcp: toContextMcp(connection.mcp, selection.capabilities),
    });
  });
  const context = Object.freeze({
    documents: Object.freeze({ provider: documents.provider }),
    issues: Object.freeze({ provider: issues.provider }),
    sourceControl: Object.freeze({ local: sourceControl.local, remote, workspaces: sourceControl.workspaces }),
    forges: Object.freeze(forges),
  });
  validateSdlcCompilerContext(context);
  return context;
}

/** Validates canonical selected connections in decoded compiler input. */
export function validateSdlcCompilerContext(context: SdlcCompilerContext): void {
  const selected = selectedForgeCapabilities(
    context.issues.provider,
    context.documents.provider,
    context.sourceControl.remote.enabled ? context.sourceControl.remote.provider : false,
  );
  const actualSelections = context.forges.map(({ provider, capabilities }) => ({ provider, capabilities }));
  if (canonicalJson(actualSelections) !== canonicalJson(selected)) {
    throw new TypeError('SDLC forge connections do not match selected capabilities.');
  }
  const commands = new Map<string, string>();
  for (const connection of context.forges) {
    const support = FORGE_SUPPORT_DECLARATIONS[connection.provider];
    if (connection.baseUrl.toLowerCase().startsWith('http://') && !connection.allowInsecureHttp) {
      throw new TypeError('SDLC forge HTTP connection lacks explicit insecure-transport opt-in.');
    }
    const configuredMcpCapabilities = [
      ...(connection.mcp.issues === undefined ? [] : (['issues'] as const)),
      ...(connection.mcp.documents === undefined ? [] : (['documents'] as const)),
      ...(connection.mcp.remoteSourceControl === undefined ? [] : (['remote-source-control'] as const)),
    ];
    if (configuredMcpCapabilities.some((capability) => !connection.capabilities.includes(capability))) {
      throw new TypeError('SDLC forge connection contains an unselected MCP service.');
    }
    for (const service of [connection.mcp.issues, connection.mcp.documents, connection.mcp.remoteSourceControl]) {
      if (service === undefined) continue;
      const command = commands.get(service.server);
      if (command !== undefined && command !== service.command) {
        throw new TypeError('SDLC forge MCP server maps to conflicting commands.');
      }
      commands.set(service.server, service.command);
    }
    for (const capability of connection.capabilities) {
      if (!support.capabilities.includes(capability)) {
        throw new TypeError('SDLC forge capability is unsupported.');
      }
      if (support.mcpRequiredFor.includes(capability) && mcpForCapability(connection.mcp, capability) === undefined) {
        throw new TypeError('SDLC forge capability is missing its MCP service.');
      }
    }
  }
}

/** Collects distinct selected forge capabilities in deterministic order. */
function selectedForgeCapabilities(
  issues: IssueProvider,
  documents: DocumentProvider,
  remote: false | RemoteSourceControlProvider,
): readonly { readonly provider: ForgeProvider; readonly capabilities: readonly ForgeCapability[] }[] {
  const selected = new Map<ForgeProvider, Set<ForgeCapability>>();
  const add = (provider: string, capability: ForgeCapability): void => {
    if (!isForgeProvider(provider)) return;
    const capabilities = selected.get(provider) ?? new Set<ForgeCapability>();
    capabilities.add(capability);
    selected.set(provider, capabilities);
  };
  add(issues, 'issues');
  add(documents, 'documents');
  if (remote !== false) add(remote, 'remote-source-control');
  return Object.freeze(
    [...selected.entries()]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([provider, capabilities]) =>
        Object.freeze({
          provider,
          capabilities: Object.freeze([...capabilities].sort(compareCodeUnits)),
        }),
      ),
  );
}

/** Returns the configuration key used for one capability-specific MCP service. */
function mcpConfigKey(capability: ForgeCapability): keyof ForgeMcpConfig {
  if (capability === 'remote-source-control') return 'remote_source_control';
  return capability;
}

/** Finds the configured MCP service for one stable capability. */
function mcpForCapability(
  mcp: ForgeMcpConfig | SdlcForgeMcpContext | undefined,
  capability: ForgeCapability,
): ForgeMcpService | undefined {
  if (mcp === undefined) return undefined;
  if (capability === 'remote-source-control') {
    return (mcp as ForgeMcpConfig).remote_source_control ?? (mcp as SdlcForgeMcpContext).remoteSourceControl;
  }
  return mcp[capability];
}

/** Converts only selected snake-case MCP leaves into immutable compiler context. */
function toContextMcp(mcp: ForgeMcpConfig | undefined, capabilities: readonly ForgeCapability[]): SdlcForgeMcpContext {
  const freezeService = (service: ForgeMcpService | undefined): ForgeMcpService | undefined =>
    service === undefined ? undefined : Object.freeze({ ...service });
  return Object.freeze({
    ...(!capabilities.includes('issues') || mcp?.issues === undefined ? {} : { issues: freezeService(mcp.issues) }),
    ...(!capabilities.includes('documents') || mcp?.documents === undefined
      ? {}
      : { documents: freezeService(mcp.documents) }),
    ...(!capabilities.includes('remote-source-control') || mcp?.remote_source_control === undefined
      ? {}
      : { remoteSourceControl: freezeService(mcp.remote_source_control) }),
  });
}

/** Maps one support capability to its authoritative selection leaf. */
function capabilitySelectionPath(capability: ForgeCapability): readonly string[] {
  if (capability === 'issues') return ['capabilities', 'issues', 'provider'];
  if (capability === 'documents') return ['capabilities', 'documents', 'provider'];
  return ['capabilities', 'source_control', 'remote'];
}

/** Orders semantic problems independently of contribution access order. */
function compareProblems(left: SdlcConfigProblem, right: SdlcConfigProblem): number {
  return compareCodeUnits(left.path.join('.'), right.path.join('.')) || compareCodeUnits(left.code, right.code);
}

/** Detaches and freezes one problem before exposing it to consumers. */
function freezeProblem(problem: SdlcConfigProblem): SdlcConfigProblem {
  return Object.freeze({ ...problem, path: Object.freeze([...problem.path]) });
}
