/** Domain-neutral contracts for composing and accessing Neottia configuration. */
export {
  CONFIG_ROOT_SECTIONS,
  type ConfigContribution,
  type ConfigDiagnostic,
  type ConfigDiagnosticCode,
  type ConfigProvenance,
  type ConfigRegistry,
  type ConfigSourceKind,
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
  ConfigResolutionError,
  getDefaultGlobalConfigPath,
  MAX_CONFIG_DIAGNOSTICS,
  resolveConfig,
  type DefaultGlobalConfigPathOptions,
  type ResolveConfigOptions,
} from './resolver.js';
export { CONFIG_JSON_SCHEMA_ID, generateConfigJsonSchema } from './schema.js';
export {
  ConfigSnapshotError,
  createResolvedConfigSnapshot,
  type ConfigShardValues,
  type ConfigSnapshotErrorCode,
} from './snapshot.js';
