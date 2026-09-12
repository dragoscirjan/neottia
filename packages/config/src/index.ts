/** Domain-neutral contracts for composing and accessing Neottia configuration. */
export {
  CONFIG_ROOT_SECTIONS,
  type ConfigContribution,
  type ConfigRegistry,
  type DeepReadonly,
  type EnvironmentBinding,
  type EnvironmentValueKind,
  type ResolvedConfigSnapshot,
  type RootSection,
  type SecretBinding,
  type UnknownConfigContribution,
} from './contracts.js';
export {
  ConfigRegistrationError,
  createConfigRegistry,
  defineConfigContribution,
  type ConfigRegistrationProblem,
  type ConfigRegistrationProblemCode,
} from './registry.js';
export {
  ConfigSnapshotError,
  createResolvedConfigSnapshot,
  type ConfigShardValues,
  type ConfigSnapshotErrorCode,
} from './snapshot.js';
