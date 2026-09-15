import { HARNESS_ASSET_ID_PATTERN, PACKAGE_VERSION_PATTERN } from './patterns.js';
import {
  HOST_FEATURES,
  type AgentProjectionRequest,
  type ExtensionProjectionRequest,
  type HarnessScope,
  type HostConfigLocator,
  type HostConfigOperation,
  type HostConfigPlan,
  type HostConfigRequest,
  type HostFeature,
  type HostPackageDeclaration,
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
} from './types.js';

const HOST_FEATURE_SET = new Set<string>(HOST_FEATURES);
const TARGET_FEATURE_SET = new Set<string>([
  'asset.prompt',
  'asset.skill',
  'asset.extension',
  'asset.agent',
  'config.package',
  'config.mcp.local',
  'config.mcp.remote',
]);
const DIAGNOSTIC_CODE_SET = new Set<string>([
  'UNSUPPORTED_HOST_FEATURE',
  'UNSUPPORTED_SCOPE',
  'UNREPRESENTABLE_METADATA',
  'INVALID_ASSET_ID',
  'INVALID_CONTENT',
  'INVALID_PACKAGE_DECLARATION',
  'INVALID_MCP_DECLARATION',
  'INVALID_REQUEST',
  'INVALID_ADAPTER_RESULT',
]);
const LOGICAL_PACKAGE_IDS = new Set<string>(['memory', 'issues', 'design-docs', 'searchable']);
const PERMISSION_VALUES = new Set<string>(['allow', 'ask', 'deny']);

/** Checks one target request received from an untyped runtime boundary. */
export function isTargetRequest(value: unknown): value is TargetRequest {
  return (
    recordWithKeys(value, ['feature', 'scope', 'assetId']) &&
    typeof value.feature === 'string' &&
    TARGET_FEATURE_SET.has(value.feature) &&
    isScope(value.scope) &&
    optionalString(value.assetId)
  );
}

/** Checks one prompt request and all nested metadata values. */
export function isPromptProjectionRequest(value: unknown): value is PromptProjectionRequest {
  if (!recordWithKeys(value, ['id', 'scope', 'body', 'metadata'])) return false;
  if (typeof value.id !== 'string' || !isScope(value.scope) || typeof value.body !== 'string') return false;
  if (value.metadata === undefined) return true;
  if (!recordWithKeys(value.metadata, ['description', 'argumentHint', 'execution'])) return false;
  if (!optionalString(value.metadata.description) || !optionalString(value.metadata.argumentHint)) return false;
  if (value.metadata.execution === undefined) return true;
  return (
    recordWithKeys(value.metadata.execution, ['agent', 'model', 'subtask']) &&
    optionalString(value.metadata.execution.agent) &&
    optionalString(value.metadata.execution.model) &&
    optionalBoolean(value.metadata.execution.subtask)
  );
}

/** Checks one skill request and its string metadata map. */
export function isSkillProjectionRequest(value: unknown): value is SkillProjectionRequest {
  return (
    recordWithKeys(value, ['id', 'scope', 'description', 'body', 'license', 'compatibility', 'metadata']) &&
    typeof value.id === 'string' &&
    isScope(value.scope) &&
    typeof value.description === 'string' &&
    typeof value.body === 'string' &&
    optionalString(value.license) &&
    optionalString(value.compatibility) &&
    (value.metadata === undefined || isStringRecord(value.metadata))
  );
}

/** Checks one extension request received from JavaScript or decoded data. */
export function isExtensionProjectionRequest(value: unknown): value is ExtensionProjectionRequest {
  return (
    recordWithKeys(value, ['id', 'scope', 'source']) &&
    typeof value.id === 'string' &&
    isScope(value.scope) &&
    typeof value.source === 'string'
  );
}

/** Checks one agent request, including enum, number, and permission values. */
export function isAgentProjectionRequest(value: unknown): value is AgentProjectionRequest {
  return (
    recordWithKeys(value, [
      'id',
      'scope',
      'body',
      'description',
      'mode',
      'modelHint',
      'thinkingHint',
      'steps',
      'permissions',
    ]) &&
    typeof value.id === 'string' &&
    isScope(value.scope) &&
    typeof value.body === 'string' &&
    typeof value.description === 'string' &&
    (value.mode === 'primary' || value.mode === 'subagent') &&
    optionalString(value.modelHint) &&
    optionalString(value.thinkingHint) &&
    (value.steps === undefined || typeof value.steps === 'number') &&
    (value.permissions === undefined || isPermissionRecord(value.permissions))
  );
}

/** Checks one logical package request before host-specific validation. */
export function isPackageProjectionRequest(value: unknown): value is PackageProjectionRequest {
  return (
    recordWithKeys(value, ['logicalId', 'scope', 'version']) &&
    typeof value.logicalId === 'string' &&
    LOGICAL_PACKAGE_IDS.has(value.logicalId) &&
    isScope(value.scope) &&
    typeof value.version === 'string'
  );
}

/** Checks the host configuration discriminant and its complete nested payload. */
export function isHostConfigRequest(value: unknown): value is HostConfigRequest {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'package') {
    return recordWithKeys(value, ['kind', 'package']) && isHostPackageDeclaration(value.package);
  }
  if (value.kind === 'mcp.local') {
    return (
      recordWithKeys(value, ['kind', 'scope', 'server']) && isScope(value.scope) && isLocalMcpDeclaration(value.server)
    );
  }
  if (value.kind === 'mcp.remote') {
    return (
      recordWithKeys(value, ['kind', 'scope', 'server']) && isScope(value.scope) && isRemoteMcpDeclaration(value.server)
    );
  }
  return false;
}

/** Checks every changed feature instead of filtering unknown values. */
export function isReloadRequest(value: unknown): value is ReloadRequest {
  return (
    recordWithKeys(value, ['changedFeatures']) &&
    Array.isArray(value.changedFeatures) &&
    value.changedFeatures.every(isHostFeature)
  );
}

/** Checks the value-or-nonempty-diagnostics invariant for adapter output. */
export function isProjectionResult(value: unknown, hostId: string): value is ProjectionResult<unknown> {
  if (!recordWithKeys(value, ['value', 'diagnostics']) || !hasOwnProperties(value, ['diagnostics'])) return false;
  if (!Array.isArray(value.diagnostics)) return false;
  const hasValue = Object.hasOwn(value, 'value') && value.value !== undefined;
  if (hasValue) return value.diagnostics.length === 0;
  return value.diagnostics.length > 0 && value.diagnostics.every((item) => isProjectionDiagnostic(item, hostId));
}

/** Checks a target result against the requested target kind. */
export function isTargetProjectionValue(
  value: unknown,
  request: TargetRequest,
): value is TargetPath | HostConfigLocator {
  if (request.feature.startsWith('config.')) return isHostConfigLocator(value, request.scope);
  return isTargetPath(value) && anchorMatchesScope(value.anchor, request.scope);
}

/** Checks a prompt file result and binds it to the input asset. */
export function isPromptProjectionValue(value: unknown, request: PromptProjectionRequest): value is ProjectedFile {
  return isProjectedFile(value, request.id, request.scope, 'asset.prompt', 'text/markdown');
}

/** Checks a skill file result and its standard name limit. */
export function isSkillProjectionValue(value: unknown, request: SkillProjectionRequest): value is ProjectedFile {
  return request.id.length <= 64 && isProjectedFile(value, request.id, request.scope, 'asset.skill', 'text/markdown');
}

/** Checks an extension file result and its TypeScript media type. */
export function isExtensionProjectionValue(
  value: unknown,
  request: ExtensionProjectionRequest,
): value is ProjectedFile {
  return isProjectedFile(value, request.id, request.scope, 'asset.extension', 'text/typescript');
}

/** Checks an agent file result and its Markdown media type. */
export function isAgentProjectionValue(value: unknown, request: AgentProjectionRequest): value is ProjectedFile {
  return isProjectedFile(value, request.id, request.scope, 'asset.agent', 'text/markdown');
}

/** Checks a package result and binds its portable fields to the request. */
export function isPackageProjectionValue(
  value: unknown,
  request: PackageProjectionRequest,
): value is HostPackageDeclaration {
  return (
    isHostPackageDeclaration(value) &&
    value.logicalId === request.logicalId &&
    value.scope === request.scope &&
    value.source.version === request.version
  );
}

/** Checks a configuration plan, operation envelopes, and host ownership. */
export function isHostConfigPlanValue(
  value: unknown,
  request: HostConfigRequest,
  hostId: string,
): value is HostConfigPlan {
  if (!recordWithKeys(value, ['hostId', 'scope', 'target', 'operations'])) return false;
  if (!hasOwnProperties(value, ['hostId', 'scope', 'target', 'operations'])) return false;
  const requestScope = request.kind === 'package' ? request.package.scope : request.scope;
  return (
    value.hostId === hostId &&
    value.scope === requestScope &&
    isHostConfigLocator(value.target, requestScope) &&
    Array.isArray(value.operations) &&
    value.operations.length > 0 &&
    value.operations.every(isHostConfigOperation)
  );
}

/** Checks a reload notice, its host, action, and affected feature list. */
export function isReloadNoticeValue(value: unknown, request: ReloadRequest, hostId: string): value is ReloadNotice {
  if (!recordWithKeys(value, ['hostId', 'action', 'command', 'message', 'affectedFeatures'])) return false;
  if (!hasOwnProperties(value, ['hostId', 'action', 'message', 'affectedFeatures'])) return false;
  if (
    value.hostId !== hostId ||
    !['none', 'command', 'restart'].includes(value.action as string) ||
    !nonblankString(value.message) ||
    !Array.isArray(value.affectedFeatures) ||
    !value.affectedFeatures.every(isHostFeature)
  ) {
    return false;
  }
  const requested = new Set(request.changedFeatures);
  if (
    value.affectedFeatures.length !== requested.size ||
    !value.affectedFeatures.every((feature) => requested.has(feature))
  ) {
    return false;
  }
  if (value.action === 'command') {
    return value.affectedFeatures.length > 0 && Object.hasOwn(value, 'command') && nonblankString(value.command);
  }
  if (value.action === 'none') return value.affectedFeatures.length === 0 && value.command === undefined;
  return value.affectedFeatures.length > 0 && value.command === undefined;
}

/** Returns a known feature from a validated or partially valid request. */
export function requestFeature(value: unknown): HostFeature | undefined {
  if (!isRecord(value) || typeof value.feature !== 'string') return undefined;
  return isHostFeature(value.feature) ? value.feature : undefined;
}

/** Returns a configuration feature from a known request discriminant. */
export function configRequestFeature(value: unknown): HostFeature | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'package') return 'config.package';
  if (value.kind === 'mcp.local') return 'config.mcp.local';
  if (value.kind === 'mcp.remote') return 'config.mcp.remote';
  return undefined;
}

/** Checks one projected file and all required structural fields. */
function isProjectedFile(
  value: unknown,
  assetId: string,
  scope: HarnessScope,
  feature: ProjectedFile['feature'],
  mediaType: ProjectedFile['mediaType'],
): value is ProjectedFile {
  return (
    recordWithKeys(value, ['assetId', 'feature', 'target', 'mediaType', 'content']) &&
    hasOwnProperties(value, ['assetId', 'feature', 'target', 'mediaType', 'content']) &&
    value.assetId === assetId &&
    HARNESS_ASSET_ID_PATTERN.test(assetId) &&
    value.feature === feature &&
    value.mediaType === mediaType &&
    isTargetPath(value.target) &&
    anchorMatchesScope(value.target.anchor, scope) &&
    typeof value.content === 'string' &&
    !value.content.includes('\0') &&
    !value.content.includes('\r')
  );
}

/** Checks a symbolic path and rejects unsafe or normalized segments. */
function isTargetPath(value: unknown): value is TargetPath {
  return (
    recordWithKeys(value, ['anchor', 'segments']) &&
    hasOwnProperties(value, ['anchor', 'segments']) &&
    ['project', 'home', 'xdg-config'].includes(value.anchor as string) &&
    Array.isArray(value.segments) &&
    value.segments.length > 0 &&
    value.segments.every(isSafePathSegment)
  );
}

/** Checks config candidates and requires the creation path to be a candidate. */
function isHostConfigLocator(value: unknown, scope: HarnessScope): value is HostConfigLocator {
  if (!recordWithKeys(value, ['candidates', 'createAt'])) return false;
  if (!hasOwnProperties(value, ['candidates', 'createAt'])) return false;
  if (!Array.isArray(value.candidates) || value.candidates.length === 0 || !value.candidates.every(isTargetPath)) {
    return false;
  }
  if (!isTargetPath(value.createAt)) return false;
  if (!value.candidates.every((candidate) => anchorMatchesScope(candidate.anchor, scope))) return false;
  if (!anchorMatchesScope(value.createAt.anchor, scope)) return false;
  const createAt = value.createAt;
  return value.candidates.some((candidate) => sameTargetPath(candidate, createAt));
}

/** Checks one host package declaration and its exact nested fields. */
function isHostPackageDeclaration(value: unknown): value is HostPackageDeclaration {
  if (!recordWithKeys(value, ['logicalId', 'scope', 'source', 'activation', 'provides'])) return false;
  if (!hasOwnProperties(value, ['logicalId', 'scope', 'source', 'activation', 'provides'])) return false;
  return (
    typeof value.logicalId === 'string' &&
    LOGICAL_PACKAGE_IDS.has(value.logicalId) &&
    isScope(value.scope) &&
    recordWithKeys(value.source, ['ecosystem', 'name', 'version']) &&
    hasOwnProperties(value.source, ['ecosystem', 'name', 'version']) &&
    value.source.ecosystem === 'npm' &&
    nonblankSafeString(value.source.name) &&
    typeof value.source.version === 'string' &&
    PACKAGE_VERSION_PATTERN.test(value.source.version) &&
    (value.activation === 'pi-package' || value.activation === 'opencode-plugin') &&
    Array.isArray(value.provides) &&
    value.provides.length === 1 &&
    value.provides[0] === 'extension'
  );
}

/** Checks one ownership-aware configuration operation envelope. */
function isHostConfigOperation(value: unknown): value is HostConfigOperation {
  if (!isRecord(value) || !hasOwnProperties(value, ['id', 'kind', 'pointer', 'owner', 'value'])) return false;
  if (!nonblankSafeString(value.id) || !validPointer(value.pointer) || value.owner !== 'neottia') return false;
  if (value.kind === 'ensure-array-entry') {
    return (
      recordWithKeys(value, ['id', 'kind', 'pointer', 'identity', 'value', 'owner']) &&
      hasOwnProperties(value, ['identity']) &&
      nonblankSafeString(value.identity) &&
      typeof value.value === 'string'
    );
  }
  if (value.kind === 'ensure-object-entry') {
    return (
      recordWithKeys(value, ['id', 'kind', 'pointer', 'key', 'value', 'owner']) &&
      hasOwnProperties(value, ['key']) &&
      nonblankSafeString(value.key) &&
      isRecord(value.value)
    );
  }
  return false;
}

/** Checks one local MCP declaration without applying host-specific semantics. */
function isLocalMcpDeclaration(value: unknown): boolean {
  return (
    recordWithKeys(value, ['name', 'command', 'cwd', 'environment', 'enabled', 'timeout']) &&
    typeof value.name === 'string' &&
    Array.isArray(value.command) &&
    value.command.length > 0 &&
    value.command.every((part) => typeof part === 'string') &&
    optionalString(value.cwd) &&
    (value.environment === undefined || isStringRecord(value.environment)) &&
    optionalBoolean(value.enabled) &&
    optionalNumber(value.timeout)
  );
}

/** Checks one remote MCP declaration without resolving credentials. */
function isRemoteMcpDeclaration(value: unknown): boolean {
  return (
    recordWithKeys(value, ['name', 'url', 'headers', 'oauth', 'enabled', 'timeout']) &&
    typeof value.name === 'string' &&
    typeof value.url === 'string' &&
    (value.headers === undefined || isStringRecord(value.headers)) &&
    (value.oauth === undefined || value.oauth === false) &&
    optionalBoolean(value.enabled) &&
    optionalNumber(value.timeout)
  );
}

/** Checks one diagnostic and prevents it from claiming another host. */
function isProjectionDiagnostic(value: unknown, hostId: string): value is ProjectionDiagnostic {
  return (
    recordWithKeys(value, ['code', 'hostId', 'feature', 'scope', 'assetId', 'message']) &&
    hasOwnProperties(value, ['code', 'hostId', 'message']) &&
    typeof value.code === 'string' &&
    DIAGNOSTIC_CODE_SET.has(value.code) &&
    value.hostId === hostId &&
    (value.feature === undefined || isHostFeature(value.feature)) &&
    (value.scope === undefined || isScope(value.scope)) &&
    optionalString(value.assetId) &&
    nonblankString(value.message)
  );
}

/** Checks one feature against the closed contract vocabulary. */
function isHostFeature(value: unknown): value is HostFeature {
  return typeof value === 'string' && HOST_FEATURE_SET.has(value);
}

/** Checks one portable installation scope. */
function isScope(value: unknown): value is HarnessScope {
  return value === 'project' || value === 'global';
}

/** Checks a record whose own enumerable keys belong to the allowed set. */
function recordWithKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

/** Requires each named field to be an own property. */
function hasOwnProperties(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.hasOwn(value, key));
}

/** Checks a plain non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Checks that a symbolic anchor matches the requested installation scope. */
function anchorMatchesScope(anchor: TargetPath['anchor'], scope: HarnessScope): boolean {
  return scope === 'project' ? anchor === 'project' : anchor === 'home' || anchor === 'xdg-config';
}

/** Compares two already validated symbolic paths. */
function sameTargetPath(left: TargetPath, right: TargetPath): boolean {
  return (
    left.anchor === right.anchor &&
    left.segments.length === right.segments.length &&
    left.segments.every((part, index) => part === right.segments[index])
  );
}

/** Rejects traversal, separators, controls, and normalization changes. */
function isSafePathSegment(value: unknown): value is string {
  return (
    nonblankString(value) &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    value.normalize('NFC') === value
  );
}

/** Checks a nonblank string. */
function nonblankString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim().length > 0;
}

/** Checks one nonblank scalar that cannot add lines or NUL bytes. */
function nonblankSafeString(value: unknown): value is string {
  return nonblankString(value) && !value.includes('\0') && !value.includes('\r') && !value.includes('\n');
}

/** Checks a nonempty JSON pointer string without interpreting its target. */
function validPointer(value: unknown): value is string {
  return nonblankSafeString(value) && value.startsWith('/');
}

/** Checks an optional string property. */
function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

/** Checks an optional boolean property. */
function optionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

/** Checks an optional number property. */
function optionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number';
}

/** Checks a string-valued record without coercion. */
function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

/** Checks an agent permission record and its closed value enum. */
function isPermissionRecord(value: unknown): boolean {
  return (
    isRecord(value) && Object.values(value).every((item) => typeof item === 'string' && PERMISSION_VALUES.has(item))
  );
}
