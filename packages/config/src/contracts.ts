import type { ZodType } from 'zod';

/** Root sections whose nested paths can be owned by configuration contributions. */
export const CONFIG_ROOT_SECTIONS = Object.freeze([
  'modules',
  'sdlc',
  'connections',
  'capabilities',
  'agents',
  'harnesses',
  'assets',
  'templates',
] as const);

/** A configurable top-level section in `.neottia/config.yml`. */
export type RootSection = (typeof CONFIG_ROOT_SECTIONS)[number];

/** Recursively removes mutation operations from a resolved configuration type. */
export type DeepReadonly<Value> = Value extends (...arguments_: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

/** Coercion supported for one environment variable binding. */
export type EnvironmentValueKind = 'string' | 'integer' | 'boolean';

/** Maps the first populated environment variable to a shard-relative path. */
export interface EnvironmentBinding {
  readonly path: readonly string[];
  readonly names: readonly [string, ...string[]];
  readonly kind: EnvironmentValueKind;
  /**
   * Converts raw environment text for a domain-specific setting. This trusted,
   * synchronous contribution hook replaces built-in `kind` coercion when set.
   */
  readonly parse?: (value: string) => unknown;
}

/** Marks a shard-relative field as secret and optionally supplies environment fallbacks. */
export interface SecretBinding {
  readonly path: readonly string[];
  readonly fallbackEnvironment?: readonly [string, ...string[]];
}

/** Domain-owned schemas and metadata used to compose one root configuration. */
export interface ConfigContribution<FilePatch, RuntimePatch, Resolved> {
  /** Stable identifier used by diagnostics and snapshot construction. */
  readonly id: string;
  /** Canonical path owned exclusively by this contribution. */
  readonly path: readonly [RootSection, ...string[]];
  /** Strict schema for one file or profile patch; it must not inject defaults. */
  readonly filePatchSchema: ZodType<FilePatch>;
  /** Strict schema for one trusted runtime override patch. */
  readonly runtimePatchSchema: ZodType<RuntimePatch>;
  /** Schema applied to the complete merged shard. */
  readonly resolvedSchema: ZodType<Resolved>;
  /** Complete lowest-precedence value for the shard. */
  readonly defaults: DeepReadonly<Resolved>;
  /** Environment bindings applied after file and profile patches. */
  readonly environment?: readonly EnvironmentBinding[];
  /** Fields whose resolved values must be redacted by the resolver. */
  readonly secrets?: readonly SecretBinding[];
  /** Deprecated source paths accepted during a migration period. */
  readonly legacyPaths?: readonly (readonly string[])[];
}

/** A contribution whose concrete shard types are not known to the registry. */
export type UnknownConfigContribution = ConfigContribution<unknown, unknown, unknown>;

/** Read-only registry of validated, non-overlapping contributions. */
export interface ConfigRegistry {
  readonly rootSections: readonly RootSection[];
  readonly contributions: readonly UnknownConfigContribution[];
}

/** Ordered source layers that can supply a resolved leaf. */
export type ConfigSourceKind = 'defaults' | 'global' | 'project' | 'profile' | 'environment' | 'override';

/** Value-free source metadata for one resolved configuration leaf. */
export interface ConfigProvenance {
  readonly kind: ConfigSourceKind;
  readonly file?: string;
  readonly profile?: string;
  readonly environment?: string;
  readonly legacyPath?: readonly string[];
  readonly label?: string;
}

/** Stable diagnostic categories emitted while resolving configuration. */
export type ConfigDiagnosticCode =
  'ENVIRONMENT' | 'IO' | 'LIMIT' | 'MERGE' | 'PATH' | 'PROFILE' | 'SCHEMA' | 'SECRET' | 'VERSION' | 'YAML';

/** A bounded, structured resolution problem that never contains rejected values. */
export interface ConfigDiagnostic {
  readonly code: ConfigDiagnosticCode;
  readonly message: string;
  readonly path?: readonly string[];
  readonly source?: ConfigProvenance;
}

/** Immutable typed access to all shards produced by one resolution. */
export interface ResolvedConfigSnapshot {
  readonly diagnostics: readonly ConfigDiagnostic[];

  get<FilePatch, RuntimePatch, Resolved>(
    contribution: ConfigContribution<FilePatch, RuntimePatch, Resolved>,
  ): DeepReadonly<Resolved>;

  /** Returns metadata for a shard-relative leaf without exposing its value. */
  sourceOf<FilePatch, RuntimePatch, Resolved>(
    contribution: ConfigContribution<FilePatch, RuntimePatch, Resolved>,
    path: readonly string[],
  ): ConfigProvenance | undefined;

  /** Serializes canonical configuration while replacing every declared secret. */
  toJSON(): DeepReadonly<Record<string, unknown>>;
}
