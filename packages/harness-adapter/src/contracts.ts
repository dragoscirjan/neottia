import { HARNESS_ASSET_ID_PATTERN } from './patterns.js';
import {
  HOST_FEATURES,
  type FeatureSupport,
  type HarnessAdapter,
  type HarnessAdapterRegistry,
  type HarnessDeclaration,
  type HarnessScope,
  type HostFeature,
  type NonEmptyDiagnostics,
  type ProjectedFile,
  type ProjectionDiagnostic,
  type ProjectionResult,
  type SkillProjectionRequest,
  type TargetPath,
} from './types.js';
import {
  configRequestFeature,
  isAgentProjectionRequest,
  isAgentProjectionValue,
  isExtensionProjectionRequest,
  isExtensionProjectionValue,
  isHostConfigPlanValue,
  isHostConfigRequest,
  isPackageProjectionRequest,
  isPackageProjectionValue,
  isProjectionResult,
  isPromptProjectionRequest,
  isPromptProjectionValue,
  isReloadNoticeValue,
  isReloadRequest,
  isSkillProjectionRequest,
  isSkillProjectionValue,
  isTargetProjectionValue,
  isTargetRequest,
  requestFeature,
} from './validation.js';

export { HARNESS_ASSET_ID_PATTERN, PACKAGE_VERSION_PATTERN } from './patterns.js';

const FEATURE_SET = new Set<string>(HOST_FEATURES);
const VALID_SCOPES = new Set<HarnessScope>(['project', 'global']);
const VALID_PROJECTIONS = new Set<FeatureSupport['projection']>(['file', 'metadata', 'host-config', 'none']);
const BOTH_SCOPES = Object.freeze(['project', 'global'] as const);
const EXPECTED_PROJECTION: Readonly<Record<HostFeature, Exclude<FeatureSupport['projection'], 'none'>>> = Object.freeze(
  Object.fromEntries(
    HOST_FEATURES.map((feature) => [
      feature,
      feature.startsWith('asset.') ? 'file' : feature.startsWith('config.') ? 'host-config' : 'metadata',
    ]),
  ) as Record<HostFeature, Exclude<FeatureSupport['projection'], 'none'>>,
);

/** Declares file, metadata, or host-config support in both portable scopes. */
export function supportedFeature(projection: FeatureSupport['projection']): FeatureSupport {
  if (!VALID_PROJECTIONS.has(projection) || projection === 'none') {
    throw new TypeError('A supported feature must declare a valid projection.');
  }
  return cloneFrozen({ status: 'supported' as const, scopes: BOTH_SCOPES, projection });
}

/** Declares an unsupported feature with an explicit human-readable reason. */
export function unsupportedFeatureSupport(reason: string): FeatureSupport {
  if (!nonblank(reason)) throw new TypeError('An unsupported feature must declare a reason.');
  return cloneFrozen({ status: 'unsupported' as const, scopes: [], projection: 'none' as const, reason });
}

/** Creates and validates one complete immutable host declaration. */
export function defineHarnessDeclaration(input: HarnessDeclaration): HarnessDeclaration {
  if (!plainRecord(input)) throw new TypeError('Harness declaration must be an object.');
  if (!hasOnlyKeys(input, ['contractVersion', 'id', 'displayName', 'testedHostVersions', 'features'])) {
    throw new TypeError('Harness declaration contains an unknown field.');
  }
  if (!hasOwnProperties(input, ['contractVersion', 'id', 'displayName', 'testedHostVersions', 'features'])) {
    throw new TypeError('Harness declaration is missing a required field.');
  }
  if (input.contractVersion !== 1) throw new TypeError('Harness declaration must use contract version 1.');
  if (typeof input.id !== 'string' || !HARNESS_ASSET_ID_PATTERN.test(input.id)) {
    throw new TypeError('Harness declaration id is invalid.');
  }
  if (!nonblank(input.displayName)) throw new TypeError('Harness declaration display name is required.');
  if (!Array.isArray(input.testedHostVersions) || input.testedHostVersions.some((version) => !nonblank(version))) {
    throw new TypeError('Harness tested host versions must be non-empty strings.');
  }
  if (!plainRecord(input.features)) throw new TypeError('Harness declaration features must be an object.');
  const keys = Object.keys(input.features);
  if (keys.length !== HOST_FEATURES.length || keys.some((key) => !FEATURE_SET.has(key))) {
    throw new TypeError('Harness declaration must contain every known feature exactly once.');
  }

  const features = Object.fromEntries(
    HOST_FEATURES.map((feature) => [feature, validateFeatureSupport(feature, input.features[feature])]),
  ) as Record<HostFeature, FeatureSupport>;
  return cloneFrozen({
    contractVersion: 1 as const,
    id: input.id,
    displayName: input.displayName,
    testedHostVersions: [...input.testedHostVersions],
    features,
  });
}

/** Snapshots an adapter and guards every request and result at runtime. */
export function defineHarnessAdapter(input: HarnessAdapter): HarnessAdapter {
  validateAdapterShape(input);
  const declaration = defineHarnessDeclaration(input.declaration);
  const methods = {
    target: input.target,
    projectPrompt: input.projectPrompt,
    projectSkill: input.projectSkill,
    projectExtension: input.projectExtension,
    projectAgent: input.projectAgent,
    declarePackage: input.declarePackage,
    planHostConfiguration: input.planHostConfiguration,
    reloadNotice: input.reloadNotice,
  };
  const adapter: HarnessAdapter = {
    declaration,
    target(request) {
      return invokeAdapter(
        methods.target,
        adapter,
        request,
        isTargetRequest,
        isTargetProjectionValue,
        declaration.id,
        requestFeature(request),
      );
    },
    projectPrompt(request) {
      return invokeAdapter(
        methods.projectPrompt,
        adapter,
        request,
        isPromptProjectionRequest,
        isPromptProjectionValue,
        declaration.id,
        'asset.prompt',
      );
    },
    projectSkill(request) {
      return invokeAdapter(
        methods.projectSkill,
        adapter,
        request,
        isSkillProjectionRequest,
        isSkillProjectionValue,
        declaration.id,
        'asset.skill',
      );
    },
    projectExtension(request) {
      return invokeAdapter(
        methods.projectExtension,
        adapter,
        request,
        isExtensionProjectionRequest,
        isExtensionProjectionValue,
        declaration.id,
        'asset.extension',
      );
    },
    projectAgent(request) {
      return invokeAdapter(
        methods.projectAgent,
        adapter,
        request,
        isAgentProjectionRequest,
        isAgentProjectionValue,
        declaration.id,
        'asset.agent',
      );
    },
    declarePackage(request) {
      return invokeAdapter(
        methods.declarePackage,
        adapter,
        request,
        isPackageProjectionRequest,
        isPackageProjectionValue,
        declaration.id,
        'config.package',
      );
    },
    planHostConfiguration(request) {
      return invokeAdapter(
        methods.planHostConfiguration,
        adapter,
        request,
        isHostConfigRequest,
        isHostConfigPlanValue,
        declaration.id,
        configRequestFeature(request),
      );
    },
    reloadNotice(request) {
      return invokeAdapter(
        methods.reloadNotice,
        adapter,
        request,
        isReloadRequest,
        isReloadNoticeValue,
        declaration.id,
      );
    },
  };
  return Object.freeze(adapter);
}

/** Creates a duplicate-rejecting registry without a central host switch. */
export function createHarnessAdapterRegistry(adapters: readonly HarnessAdapter[]): HarnessAdapterRegistry {
  if (!Array.isArray(adapters)) throw new TypeError('Harness adapters must be an array.');
  const byId = new Map<string, HarnessAdapter>();
  for (const input of adapters) {
    const adapter = defineHarnessAdapter(input);
    if (byId.has(adapter.declaration.id)) throw new TypeError('Harness adapter ids must be unique.');
    byId.set(adapter.declaration.id, adapter);
  }
  const ordered = Object.freeze([...byId.values()]);
  return Object.freeze({
    adapters: ordered,
    get(id: string): HarnessAdapter | undefined {
      return byId.get(id);
    },
  });
}

/** Returns a detached immutable success result. */
export function projectionSuccess<T>(value: T): ProjectionResult<T> {
  return Object.freeze({ value: cloneFrozen(value), diagnostics: Object.freeze([]) as readonly [] });
}

/** Returns detached immutable diagnostics without projection output. */
export function projectionFailure<T>(diagnostics: readonly ProjectionDiagnostic[]): ProjectionResult<T> {
  if (diagnostics.length === 0) throw new TypeError('A failed projection requires at least one diagnostic.');
  return Object.freeze({ diagnostics: cloneFrozen(diagnostics) as NonEmptyDiagnostics });
}

/** Invokes one captured adapter method after request validation. */
function invokeAdapter<TRequest, TResult>(
  method: (request: TRequest) => ProjectionResult<TResult>,
  receiver: HarnessAdapter,
  request: TRequest,
  validRequest: (value: unknown) => value is TRequest,
  validValue: (value: unknown, request: TRequest, hostId: string) => value is TResult,
  hostId: string,
  feature?: HostFeature,
): ProjectionResult<TResult> {
  if (!validRequest(request)) return projectionFailure([invalidRequest(hostId, feature)]);
  let result: unknown;
  try {
    result = Reflect.apply(method, receiver, [request]);
  } catch {
    return projectionFailure([invalidAdapterResult(hostId, feature)]);
  }
  try {
    if (!isProjectionResult(result, hostId)) return projectionFailure([invalidAdapterResult(hostId, feature)]);
    if (result.value !== undefined) {
      if (!validValue(result.value, request, hostId)) {
        return projectionFailure([invalidAdapterResult(hostId, feature)]);
      }
      return projectionSuccess(result.value);
    }
    return projectionFailure(result.diagnostics);
  } catch {
    return projectionFailure([invalidAdapterResult(hostId, feature)]);
  }
}

/** Builds a value-free malformed request diagnostic. */
function invalidRequest(hostId: string, feature?: HostFeature): ProjectionDiagnostic {
  return cloneFrozen({
    code: 'INVALID_REQUEST' as const,
    hostId,
    ...(feature === undefined ? {} : { feature }),
    message: 'The adapter request does not satisfy the runtime contract.',
  });
}

/** Builds a value-free diagnostic for malformed third-party adapter output. */
function invalidAdapterResult(hostId: string, feature?: HostFeature): ProjectionDiagnostic {
  return cloneFrozen({
    code: 'INVALID_ADAPTER_RESULT' as const,
    hostId,
    ...(feature === undefined ? {} : { feature }),
    message: 'The adapter returned a result that does not satisfy the runtime contract.',
  });
}

/** Builds one value-free unsupported feature diagnostic. */
export function unsupportedFeature(
  hostId: string,
  feature: HostFeature,
  scope?: HarnessScope,
  assetId?: string,
): ProjectionDiagnostic {
  return cloneFrozen({
    code: 'UNSUPPORTED_HOST_FEATURE' as const,
    hostId,
    feature,
    ...(scope === undefined ? {} : { scope }),
    ...(assetId === undefined ? {} : { assetId }),
    message: 'The selected host does not support this feature.',
  });
}

/** Validates one identifier without exposing its rejected value. */
export function invalidAssetId(
  hostId: string,
  feature: HostFeature,
  scope: HarnessScope,
  assetId: string,
): ProjectionDiagnostic | undefined {
  if (HARNESS_ASSET_ID_PATTERN.test(assetId)) return undefined;
  return cloneFrozen({
    code: 'INVALID_ASSET_ID' as const,
    hostId,
    feature,
    scope,
    message: 'The asset id must use lowercase letters, numbers, and single hyphen separators.',
  });
}

/** Validates plain generated content while preserving accepted bytes. */
export function invalidContent(
  hostId: string,
  feature: HostFeature,
  scope: HarnessScope,
  assetId: string,
  content: string,
): ProjectionDiagnostic | undefined {
  if (typeof content === 'string' && !content.includes('\0') && !content.includes('\r')) return undefined;
  return cloneFrozen({
    code: 'INVALID_CONTENT' as const,
    hostId,
    feature,
    scope,
    assetId,
    message: 'Generated content must use LF line endings and contain no NUL characters.',
  });
}

/** Creates a symbolic path after validating every segment. */
export function targetPath(anchor: TargetPath['anchor'], segments: readonly string[]): TargetPath {
  if (segments.length === 0 || segments.some((segment) => !safePathSegment(segment))) {
    throw new TypeError('Target path contains an unsafe segment.');
  }
  return cloneFrozen({ anchor, segments: [...segments] });
}

/** Renders deterministic Markdown frontmatter followed by an unchanged LF body. */
export function renderMarkdown(
  entries: readonly (readonly [string, string | boolean | number | Readonly<Record<string, string>>])[],
  body: string,
): string {
  const lines = ['---'];
  for (const [key, value] of entries) {
    lines.push(`${key}: ${renderYamlValue(value)}`);
  }
  lines.push('---', body);
  return lines.join('\n');
}

/** Renders the shared Agent Skills file used by all supported hosts. */
export function projectSkillFile(
  hostId: string,
  request: SkillProjectionRequest,
  target: TargetPath,
): ProjectionResult<ProjectedFile> {
  const genericIdProblem = invalidAssetId(hostId, 'asset.skill', request.scope, request.id);
  const idProblem =
    genericIdProblem ??
    (request.id.length > 64
      ? cloneFrozen({
          code: 'INVALID_ASSET_ID' as const,
          hostId,
          feature: 'asset.skill' as const,
          scope: request.scope,
          message: 'A skill name cannot exceed 64 characters.',
        })
      : undefined);
  const contentProblem = invalidContent(hostId, 'asset.skill', request.scope, request.id, request.body);
  const descriptionValid = nonblank(request.description) && request.description.length <= 1024;
  const licenseValid = request.license === undefined || nonblank(request.license);
  const compatibilityValid =
    request.compatibility === undefined || (nonblank(request.compatibility) && request.compatibility.length <= 500);
  const metadataValid =
    request.metadata === undefined ||
    Object.entries(request.metadata).every(([key, value]) => nonblank(key) && typeof value === 'string');
  if (
    idProblem !== undefined ||
    contentProblem !== undefined ||
    !descriptionValid ||
    !licenseValid ||
    !compatibilityValid ||
    !metadataValid
  ) {
    const diagnostics = [idProblem, contentProblem].filter(
      (problem): problem is ProjectionDiagnostic => problem !== undefined,
    );
    if (!descriptionValid || !licenseValid || !compatibilityValid || !metadataValid) {
      diagnostics.push({
        code: 'INVALID_CONTENT',
        hostId,
        feature: 'asset.skill',
        scope: request.scope,
        assetId: request.id,
        message: 'Skill metadata does not satisfy the shared Agent Skills contract.',
      });
    }
    return projectionFailure(diagnostics);
  }
  const entries: Array<readonly [string, string | Readonly<Record<string, string>>]> = [
    ['name', request.id],
    ['description', request.description],
  ];
  if (request.license !== undefined) entries.push(['license', request.license]);
  if (request.compatibility !== undefined) entries.push(['compatibility', request.compatibility]);
  if (request.metadata !== undefined) entries.push(['metadata', sortRecord(request.metadata)]);
  return projectionSuccess({
    assetId: request.id,
    feature: 'asset.skill' as const,
    target,
    mediaType: 'text/markdown' as const,
    content: renderMarkdown(entries, request.body),
  });
}

/** Returns a stable copy with keys sorted for deterministic serialization. */
export function sortRecord<T>(record: Readonly<Record<string, T>>): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

/** Detaches and recursively freezes adapter output. */
export function cloneFrozen<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => cloneFrozen(item))) as T;
  if (value !== null && typeof value === 'object') {
    const cloned = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneFrozen(item)]),
    );
    return Object.freeze(cloned) as T;
  }
  return value;
}

/** Checks one feature support declaration for closed values and consistency. */
function validateFeatureSupport(feature: HostFeature, support: FeatureSupport): FeatureSupport {
  if (!plainRecord(support) || !hasOnlyKeys(support, ['status', 'scopes', 'projection', 'reason'])) {
    throw new TypeError(`Harness feature ${feature} has an invalid support declaration.`);
  }
  if (!hasOwnProperties(support, ['status', 'scopes', 'projection'])) {
    throw new TypeError(`Harness feature ${feature} is missing support fields.`);
  }
  if (support.status !== 'supported' && support.status !== 'unsupported') {
    throw new TypeError(`Harness feature ${feature} has an invalid status.`);
  }
  if (!Array.isArray(support.scopes)) throw new TypeError(`Harness feature ${feature} has invalid scopes.`);
  if (
    support.scopes.some((scope) => typeof scope !== 'string' || !VALID_SCOPES.has(scope as HarnessScope)) ||
    new Set(support.scopes).size !== support.scopes.length
  ) {
    throw new TypeError(`Harness feature ${feature} has invalid scopes.`);
  }
  if (
    typeof support.projection !== 'string' ||
    !VALID_PROJECTIONS.has(support.projection as FeatureSupport['projection'])
  ) {
    throw new TypeError(`Harness feature ${feature} has an invalid projection.`);
  }
  if (support.reason !== undefined && typeof support.reason !== 'string') {
    throw new TypeError(`Harness feature ${feature} has an invalid reason.`);
  }
  if (support.status === 'unsupported') {
    if (support.scopes.length !== 0 || support.projection !== 'none' || !nonblank(support.reason)) {
      throw new TypeError(`Unsupported harness feature ${feature} must declare no projection and a reason.`);
    }
  } else if (
    support.scopes.length === 0 ||
    support.projection !== EXPECTED_PROJECTION[feature] ||
    Object.hasOwn(support, 'reason')
  ) {
    throw new TypeError(`Supported harness feature ${feature} has inconsistent support data.`);
  }
  return cloneFrozen(support as unknown as FeatureSupport);
}

/** Ensures a supplied value implements the complete synchronous contract. */
function validateAdapterShape(adapter: HarnessAdapter): void {
  if (adapter === null || typeof adapter !== 'object') throw new TypeError('Harness adapter must be an object.');
  defineHarnessDeclaration(adapter.declaration);
  for (const method of [
    'target',
    'projectPrompt',
    'projectSkill',
    'projectExtension',
    'projectAgent',
    'declarePackage',
    'planHostConfiguration',
    'reloadNotice',
  ] as const) {
    if (typeof adapter[method] !== 'function') throw new TypeError(`Harness adapter is missing ${method}.`);
  }
}

/** Checks a plain object before reading declaration fields. */
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Checks that an object contains no unknown own enumerable fields. */
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Checks that an object owns every required field. */
function hasOwnProperties(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(value, key));
}

/** Rejects blank user-facing metadata. */
function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim().length > 0;
}

/** Rejects traversal, separators, dot segments, and normalization changes. */
function safePathSegment(segment: string): boolean {
  return (
    nonblank(segment) &&
    segment !== '.' &&
    segment !== '..' &&
    !segment.includes('/') &&
    !segment.includes('\\') &&
    !segment.includes('\0') &&
    segment.normalize('NFC') === segment
  );
}

/** Uses JSON-compatible YAML scalars and stable flow mappings. */
function renderYamlValue(value: string | boolean | number | Readonly<Record<string, string>>): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(sortRecord(value));
}
