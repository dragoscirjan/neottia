import {
  CONFIG_ROOT_SECTIONS,
  type ConfigContribution,
  type ConfigRegistry,
  type EnvironmentBinding,
  type RootSection,
  type SecretBinding,
  type UnknownConfigContribution,
} from './contracts.js';
import { cloneAndFreezeConfigValue } from './immutable.js';

/** Stable categories for contribution registration failures. */
export type ConfigRegistrationProblemCode =
  | 'ALIAS_COLLISION'
  | 'DUPLICATE_ID'
  | 'DUPLICATE_PATH'
  | 'INVALID_DEFAULTS'
  | 'INVALID_ENVIRONMENT_BINDING'
  | 'INVALID_ID'
  | 'INVALID_PATH'
  | 'INVALID_SCHEMA'
  | 'INVALID_SECRET_BINDING'
  | 'OVERLAPPING_PATH';

/** One value-free explanation of invalid registry metadata. */
export interface ConfigRegistrationProblem {
  readonly code: ConfigRegistrationProblemCode;
  readonly contributionId?: string;
  readonly path?: readonly string[];
  readonly message: string;
}

/** Reports every deterministically ordered problem found during registration. */
export class ConfigRegistrationError extends Error {
  readonly code = 'CONFIG_REGISTRATION_FAILED';
  readonly problems: readonly ConfigRegistrationProblem[];

  constructor(problems: readonly ConfigRegistrationProblem[]) {
    const ordered = sortProblems(problems);
    super(`Configuration registration failed: ${ordered.map((problem) => problem.message).join('; ')}`);
    this.name = 'ConfigRegistrationError';
    this.problems = Object.freeze(ordered.map(freezeProblem));
  }
}

interface RegistryState {
  readonly contributionIds: ReadonlyMap<UnknownConfigContribution, string>;
  readonly contributionsById: ReadonlyMap<string, UnknownConfigContribution>;
}

interface OwnedPath {
  readonly contributionId: string;
  readonly path: readonly string[];
  readonly legacy: boolean;
}

const ROOT_SECTION_SET = new Set<string>(CONFIG_ROOT_SECTIONS);
const registryStates = new WeakMap<ConfigRegistry, RegistryState>();

/** Defines and freezes one independently reusable configuration contribution. */
export function defineConfigContribution<FilePatch, RuntimePatch, Resolved>(
  contribution: ConfigContribution<FilePatch, RuntimePatch, Resolved>,
): ConfigContribution<FilePatch, RuntimePatch, Resolved> {
  const problems = validateContributions([contribution as UnknownConfigContribution]);
  if (problems.length > 0) {
    throw new ConfigRegistrationError(problems);
  }
  return normalizeContribution(contribution);
}

/** Registers contributions after enforcing exclusive, deterministic path ownership. */
export function createConfigRegistry(contributions: readonly UnknownConfigContribution[]): ConfigRegistry {
  const problems = validateContributions(contributions);
  if (problems.length > 0) {
    throw new ConfigRegistrationError(problems);
  }

  const normalized = contributions.map(normalizeContribution);
  normalized.sort(compareContributions);
  const publicContributions = Object.freeze(normalized);
  const registry = Object.freeze({
    contributions: publicContributions,
    rootSections: CONFIG_ROOT_SECTIONS,
  });
  const contributionIds = new Map<UnknownConfigContribution, string>();
  const contributionsById = new Map<string, UnknownConfigContribution>();
  for (let index = 0; index < contributions.length; index += 1) {
    const source = contributions[index];
    const registered = normalized.find((candidate) => candidate.id === source.id);
    if (registered === undefined) {
      throw new Error('validated contribution was not registered');
    }
    contributionIds.set(source, source.id);
    contributionIds.set(registered, source.id);
    contributionsById.set(source.id, registered);
  }
  registryStates.set(registry, { contributionIds, contributionsById });
  return registry;
}

/** Returns private state only for registries created by this package. */
export function getRegistryState(registry: ConfigRegistry): RegistryState | undefined {
  return registryStates.get(registry);
}

/** Creates a detached immutable copy of contribution metadata. */
function normalizeContribution<FilePatch, RuntimePatch, Resolved>(
  contribution: ConfigContribution<FilePatch, RuntimePatch, Resolved>,
): ConfigContribution<FilePatch, RuntimePatch, Resolved> {
  return Object.freeze({
    ...contribution,
    defaults: cloneAndFreezeConfigValue(contribution.defaults),
    environment: contribution.environment
      ? Object.freeze(contribution.environment.map(freezeEnvironmentBinding))
      : undefined,
    legacyPaths: contribution.legacyPaths
      ? Object.freeze(contribution.legacyPaths.map((path) => Object.freeze([...path])))
      : undefined,
    path: Object.freeze([...contribution.path]) as unknown as readonly [RootSection, ...string[]],
    secrets: contribution.secrets ? Object.freeze(contribution.secrets.map(freezeSecretBinding)) : undefined,
  });
}

/** Copies an environment binding so callers cannot change registry behavior later. */
function freezeEnvironmentBinding(binding: EnvironmentBinding): EnvironmentBinding {
  return Object.freeze({
    kind: binding.kind,
    names: Object.freeze([...binding.names]) as unknown as readonly [string, ...string[]],
    path: Object.freeze([...binding.path]),
    parse: binding.parse,
  });
}

/** Copies a secret binding so callers cannot change registry behavior later. */
function freezeSecretBinding(binding: SecretBinding): SecretBinding {
  return Object.freeze({
    fallbackEnvironment: binding.fallbackEnvironment
      ? (Object.freeze([...binding.fallbackEnvironment]) as unknown as readonly [string, ...string[]])
      : undefined,
    path: Object.freeze([...binding.path]),
  });
}

/** Collects metadata and ownership problems without depending on input order. */
function validateContributions(contributions: readonly UnknownConfigContribution[]): ConfigRegistrationProblem[] {
  const problems: ConfigRegistrationProblem[] = [];
  for (const contribution of contributions) {
    problems.push(...validateContribution(contribution));
  }

  const byId = new Map<string, number>();
  for (const contribution of contributions) {
    byId.set(contribution.id, (byId.get(contribution.id) ?? 0) + 1);
  }
  for (const [id, count] of byId) {
    if (count > 1) {
      problems.push({ code: 'DUPLICATE_ID', contributionId: id, message: `duplicate contribution id "${id}"` });
    }
  }

  const ownedPaths = contributions.flatMap(collectOwnedPaths).sort(compareOwnedPaths);
  for (let leftIndex = 0; leftIndex < ownedPaths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ownedPaths.length; rightIndex += 1) {
      const left = ownedPaths[leftIndex];
      const right = ownedPaths[rightIndex];
      if (!pathsOverlap(left.path, right.path)) continue;

      const exact = pathsEqual(left.path, right.path);
      const alias = left.legacy || right.legacy;
      const code: ConfigRegistrationProblemCode = exact
        ? alias
          ? 'ALIAS_COLLISION'
          : 'DUPLICATE_PATH'
        : 'OVERLAPPING_PATH';
      const relation = exact ? 'duplicate' : 'overlapping';
      problems.push({
        code,
        path: left.path,
        message: `${relation} shard paths "${formatPath(left.path)}" owned by "${left.contributionId}" and "${right.contributionId}"`,
      });
    }
  }
  return sortProblems(problems);
}

/** Validates one contribution's scalar, schema, and binding metadata. */
function validateContribution(contribution: UnknownConfigContribution): ConfigRegistrationProblem[] {
  const problems: ConfigRegistrationProblem[] = [];
  const id = contribution.id;
  if (typeof id !== 'string' || id.length === 0 || id.trim() !== id) {
    problems.push({ code: 'INVALID_ID', message: 'contribution id must be a non-empty trimmed string' });
  }
  if (!isCanonicalPath(contribution.path)) {
    problems.push({
      code: 'INVALID_PATH',
      contributionId: id,
      path: Array.isArray(contribution.path) ? contribution.path : undefined,
      message: `contribution "${id}" must own a path beneath a registered root section`,
    });
  }
  if (!isSchema(contribution.filePatchSchema)) {
    problems.push({
      code: 'INVALID_SCHEMA',
      contributionId: id,
      message: `contribution "${id}" has no file patch schema`,
    });
  }
  if (!isSchema(contribution.runtimePatchSchema)) {
    problems.push({
      code: 'INVALID_SCHEMA',
      contributionId: id,
      message: `contribution "${id}" has no runtime patch schema`,
    });
  }
  if (!isSchema(contribution.resolvedSchema)) {
    problems.push({
      code: 'INVALID_SCHEMA',
      contributionId: id,
      message: `contribution "${id}" has no resolved schema`,
    });
  } else if (!hasValidDefaults(contribution)) {
    problems.push({
      code: 'INVALID_DEFAULTS',
      contributionId: id,
      message: `contribution "${id}" defaults do not satisfy its resolved schema`,
    });
  }

  for (const path of contribution.legacyPaths ?? []) {
    if (!isLegacyPath(path)) {
      problems.push({
        code: 'INVALID_PATH',
        contributionId: id,
        path,
        message: `contribution "${id}" has an invalid legacy path`,
      });
    }
  }
  for (const binding of contribution.environment ?? []) {
    if (!isEnvironmentBinding(binding)) {
      problems.push({
        code: 'INVALID_ENVIRONMENT_BINDING',
        contributionId: id,
        message: `contribution "${id}" has an invalid environment binding`,
      });
    }
  }
  for (const binding of contribution.secrets ?? []) {
    if (!isSecretBinding(binding)) {
      problems.push({
        code: 'INVALID_SECRET_BINDING',
        contributionId: id,
        message: `contribution "${id}" has an invalid secret binding`,
      });
    }
  }
  return problems;
}

/** Defaults must parse synchronously and remain representable as immutable config data. */
function hasValidDefaults(contribution: UnknownConfigContribution): boolean {
  try {
    const result = contribution.resolvedSchema.safeParse(contribution.defaults);
    if (!result.success) return false;
    cloneAndFreezeConfigValue(result.data);
    return true;
  } catch {
    return false;
  }
}

/** Checks the small runtime surface required from a Zod schema. */
function isSchema(value: unknown): value is UnknownConfigContribution['resolvedSchema'] {
  return typeof value === 'object' && value !== null && 'safeParse' in value && typeof value.safeParse === 'function';
}

/** Canonical ownership is restricted to the fixed public root sections. */
function isCanonicalPath(path: readonly string[]): path is readonly [RootSection, ...string[]] {
  return isPath(path) && ROOT_SECTION_SET.has(path[0]);
}

/** Legacy aliases may use retired roots but cannot claim root document metadata. */
function isLegacyPath(path: readonly string[]): boolean {
  return isPath(path) && path[0] !== 'version' && path[0] !== 'profiles';
}

/** Every path consists of non-empty, already-trimmed key segments. */
function isPath(path: readonly string[]): path is readonly [string, ...string[]] {
  return (
    Array.isArray(path) &&
    path.length > 0 &&
    path.every((segment) => typeof segment === 'string' && segment.length > 0 && segment.trim() === segment)
  );
}

/** Environment bindings target one leaf and list names in precedence order. */
function isEnvironmentBinding(binding: EnvironmentBinding): boolean {
  return (
    typeof binding === 'object' &&
    binding !== null &&
    isPath(binding.path) &&
    ['string', 'integer', 'boolean'].includes(binding.kind) &&
    isNonEmptyNames(binding.names) &&
    (binding.parse === undefined || typeof binding.parse === 'function')
  );
}

/** Secret bindings target one leaf and may list fallback names in precedence order. */
function isSecretBinding(binding: SecretBinding): boolean {
  return (
    typeof binding === 'object' &&
    binding !== null &&
    isPath(binding.path) &&
    (binding.fallbackEnvironment === undefined || isNonEmptyNames(binding.fallbackEnvironment))
  );
}

/** Variable names are non-empty and trimmed; resolver-specific syntax is validated later. */
function isNonEmptyNames(names: readonly string[]): names is readonly [string, ...string[]] {
  return (
    Array.isArray(names) &&
    names.length > 0 &&
    names.every((name) => typeof name === 'string' && name.length > 0 && name.trim() === name)
  );
}

/** Returns canonical and legacy ownership claims for collision validation. */
function collectOwnedPaths(contribution: UnknownConfigContribution): OwnedPath[] {
  const paths: OwnedPath[] = [{ contributionId: contribution.id, path: contribution.path, legacy: false }];
  for (const path of contribution.legacyPaths ?? []) {
    paths.push({ contributionId: contribution.id, path, legacy: true });
  }
  return paths;
}

/** Paths conflict when either one owns the other as a prefix. */
function pathsOverlap(left: readonly string[], right: readonly string[]): boolean {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Exact path equality avoids ambiguous dot-joined key comparisons. */
function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

/** Stable path rendering is used only after segment validation. */
function formatPath(path: readonly string[]): string {
  return path.join('.');
}

/** Sorts ownership claims independently of caller registration order. */
function compareOwnedPaths(left: OwnedPath, right: OwnedPath): number {
  return (
    JSON.stringify(left.path).localeCompare(JSON.stringify(right.path)) ||
    left.contributionId.localeCompare(right.contributionId) ||
    Number(left.legacy) - Number(right.legacy)
  );
}

/** Sorts public registry entries by stable contribution identity. */
function compareContributions(left: UnknownConfigContribution, right: UnknownConfigContribution): number {
  return left.id.localeCompare(right.id) || JSON.stringify(left.path).localeCompare(JSON.stringify(right.path));
}

/** Sorts diagnostics so equivalent invalid registries produce equivalent errors. */
function sortProblems(problems: readonly ConfigRegistrationProblem[]): ConfigRegistrationProblem[] {
  return [...problems].sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.contributionId ?? '').localeCompare(right.contributionId ?? '') ||
      JSON.stringify(left.path ?? []).localeCompare(JSON.stringify(right.path ?? [])) ||
      left.message.localeCompare(right.message),
  );
}

/** Freezes copied problem paths while excluding rejected values from diagnostics. */
function freezeProblem(problem: ConfigRegistrationProblem): ConfigRegistrationProblem {
  return Object.freeze({ ...problem, path: problem.path ? Object.freeze([...problem.path]) : undefined });
}
