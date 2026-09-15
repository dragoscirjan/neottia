/** Stable feature names used by every harness adapter declaration. */
export const HOST_FEATURES = Object.freeze([
  'asset.prompt',
  'asset.skill',
  'asset.extension',
  'asset.agent',
  'config.package',
  'config.mcp.local',
  'config.mcp.remote',
  'prompt.description',
  'prompt.argument-hint',
  'prompt.agent',
  'prompt.model',
  'prompt.subtask',
  'agent.primary',
  'agent.subagent',
  'agent.model',
  'agent.permissions',
  'agent.steps',
  'agent.thinking',
] as const);

/** One capability that an adapter must explicitly support or reject. */
export type HostFeature = (typeof HOST_FEATURES)[number];
/** Installation scope understood by the common adapter contract. */
export type HarnessScope = 'project' | 'global';
/** Symbolic roots resolved by the installer rather than an adapter. */
export type PathAnchor = 'project' | 'home' | 'xdg-config';
/** Native Neottia runtime package families known to the initial adapters. */
export type NeottiaRuntimePackageId = 'memory' | 'issues' | 'design-docs' | 'searchable';

/** Explicit support state for one host feature. */
export interface FeatureSupport {
  readonly status: 'supported' | 'unsupported';
  readonly scopes: readonly HarnessScope[];
  readonly projection: 'file' | 'host-config' | 'metadata' | 'none';
  readonly reason?: string;
}

/** Complete, versioned capabilities for one host adapter. */
export interface HarnessDeclaration {
  readonly contractVersion: 1;
  readonly id: string;
  readonly displayName: string;
  readonly testedHostVersions: readonly string[];
  readonly features: Readonly<Record<HostFeature, FeatureSupport>>;
}

/** A path that contains no machine-specific absolute prefix. */
export interface TargetPath {
  readonly anchor: PathAnchor;
  readonly segments: readonly string[];
}

/** Existing host config candidates and the path used when none exists. */
export interface HostConfigLocator {
  readonly candidates: readonly TargetPath[];
  readonly createAt: TargetPath;
}

/** Stable diagnostic codes returned instead of guessed host output. */
export type ProjectionDiagnosticCode =
  | 'UNSUPPORTED_HOST_FEATURE'
  | 'UNSUPPORTED_SCOPE'
  | 'UNREPRESENTABLE_METADATA'
  | 'INVALID_ASSET_ID'
  | 'INVALID_CONTENT'
  | 'INVALID_PACKAGE_DECLARATION'
  | 'INVALID_MCP_DECLARATION'
  | 'INVALID_REQUEST'
  | 'INVALID_ADAPTER_RESULT';

/** One value-free adapter projection problem. */
export interface ProjectionDiagnostic {
  readonly code: ProjectionDiagnosticCode;
  readonly hostId: string;
  readonly feature?: HostFeature;
  readonly scope?: HarnessScope;
  readonly assetId?: string;
  readonly message: string;
}

/** At least one diagnostic returned for a failed projection. */
export type NonEmptyDiagnostics = readonly [ProjectionDiagnostic, ...ProjectionDiagnostic[]];

/** A deterministic projection value or diagnostics, never both. */
export type ProjectionResult<T> =
  | { readonly value: T; readonly diagnostics: readonly [] }
  | { readonly value?: undefined; readonly diagnostics: NonEmptyDiagnostics };

/** File content and symbolic destination produced by an adapter. */
export interface ProjectedFile {
  readonly assetId: string;
  readonly feature: 'asset.prompt' | 'asset.skill' | 'asset.extension' | 'asset.agent';
  readonly target: TargetPath;
  readonly mediaType: 'text/markdown' | 'text/typescript';
  readonly content: string;
}

/** Host-neutral metadata for one invocable prompt. */
export interface PromptMetadata {
  readonly description?: string;
  readonly argumentHint?: string;
  readonly execution?: {
    readonly agent?: string;
    readonly model?: string;
    readonly subtask?: boolean;
  };
}

/** Prompt input consumed by every adapter. */
export interface PromptProjectionRequest {
  readonly id: string;
  readonly scope: HarnessScope;
  readonly body: string;
  readonly metadata?: PromptMetadata;
}

/** Agent Skills input shared by all supported hosts. */
export interface SkillProjectionRequest {
  readonly id: string;
  readonly scope: HarnessScope;
  readonly description: string;
  readonly body: string;
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Source code for one local host extension or plugin. */
export interface ExtensionProjectionRequest {
  readonly id: string;
  readonly scope: HarnessScope;
  readonly source: string;
}

/** Host-neutral agent definition populated by later role compilation. */
export interface AgentProjectionRequest {
  readonly id: string;
  readonly scope: HarnessScope;
  readonly body: string;
  readonly description: string;
  readonly mode: 'primary' | 'subagent';
  readonly modelHint?: string;
  readonly thinkingHint?: string;
  readonly steps?: number;
  readonly permissions?: Readonly<Record<string, 'allow' | 'ask' | 'deny'>>;
}

/** Request for a host-specific Neottia runtime package declaration. */
export interface PackageProjectionRequest {
  readonly logicalId: NeottiaRuntimePackageId;
  readonly scope: HarnessScope;
  readonly version: string;
}

/** Package data reviewed or installed by a later planner. */
export interface HostPackageDeclaration {
  readonly logicalId: NeottiaRuntimePackageId;
  readonly scope: HarnessScope;
  readonly source: {
    readonly ecosystem: 'npm';
    readonly name: string;
    readonly version: string;
  };
  readonly activation: 'pi-package' | 'opencode-plugin';
  readonly provides: readonly ['extension'];
}

/** Local MCP process declaration with argv boundaries preserved. */
export interface LocalMcpDeclaration {
  readonly name: string;
  readonly command: readonly [string, ...string[]];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
  readonly timeout?: number;
}

/** Remote MCP declaration that leaves credential references unresolved. */
export interface RemoteMcpDeclaration {
  readonly name: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly oauth?: false;
  readonly enabled?: boolean;
  readonly timeout?: number;
}

/** Supported semantic host configuration requests. */
export type HostConfigRequest =
  | { readonly kind: 'package'; readonly package: HostPackageDeclaration }
  | { readonly kind: 'mcp.local'; readonly scope: HarnessScope; readonly server: LocalMcpDeclaration }
  | { readonly kind: 'mcp.remote'; readonly scope: HarnessScope; readonly server: RemoteMcpDeclaration };

/** Reviewable operation that preserves unrelated host configuration. */
export type HostConfigOperation =
  | {
      readonly id: string;
      readonly kind: 'ensure-array-entry';
      readonly pointer: string;
      readonly identity: string;
      readonly value: string;
      readonly owner: 'neottia';
    }
  | {
      readonly id: string;
      readonly kind: 'ensure-object-entry';
      readonly pointer: string;
      readonly key: string;
      readonly value: Readonly<Record<string, unknown>>;
      readonly owner: 'neottia';
    };

/** Host configuration changes held as data until an installer applies them. */
export interface HostConfigPlan {
  readonly hostId: string;
  readonly scope: HarnessScope;
  readonly target: HostConfigLocator;
  readonly operations: readonly HostConfigOperation[];
}

/** Features changed by a future installation plan. */
export interface ReloadRequest {
  readonly changedFeatures: readonly HostFeature[];
}

/** Action that a caller can display after applying a plan. */
export interface ReloadNotice {
  readonly hostId: string;
  readonly action: 'none' | 'command' | 'restart';
  readonly command?: string;
  readonly message: string;
  readonly affectedFeatures: readonly HostFeature[];
}

/** Request for an asset path or host configuration locator. */
export interface TargetRequest {
  readonly feature:
    | 'asset.prompt'
    | 'asset.skill'
    | 'asset.extension'
    | 'asset.agent'
    | 'config.package'
    | 'config.mcp.local'
    | 'config.mcp.remote';
  readonly scope: HarnessScope;
  readonly assetId?: string;
}

/** Pure adapter API implemented independently by each host package. */
export interface HarnessAdapter {
  readonly declaration: HarnessDeclaration;
  target(request: TargetRequest): ProjectionResult<TargetPath | HostConfigLocator>;
  projectPrompt(request: PromptProjectionRequest): ProjectionResult<ProjectedFile>;
  projectSkill(request: SkillProjectionRequest): ProjectionResult<ProjectedFile>;
  projectExtension(request: ExtensionProjectionRequest): ProjectionResult<ProjectedFile>;
  projectAgent(request: AgentProjectionRequest): ProjectionResult<ProjectedFile>;
  declarePackage(request: PackageProjectionRequest): ProjectionResult<HostPackageDeclaration>;
  planHostConfiguration(request: HostConfigRequest): ProjectionResult<HostConfigPlan>;
  reloadNotice(request: ReloadRequest): ProjectionResult<ReloadNotice>;
}

/** Read-only lookup collection composed by an application. */
export interface HarnessAdapterRegistry {
  readonly adapters: readonly HarnessAdapter[];
  get(id: string): HarnessAdapter | undefined;
}
