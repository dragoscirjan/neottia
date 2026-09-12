# @neottia/config

`@neottia/config` is Neottia's domain-neutral configuration platform. Domain packages contribute their schemas, defaults, environment bindings, and secret fields. A registry resolves those contributions together, so every consumer receives one coherent immutable snapshot without `@neottia/config` importing a domain, MCP, or harness package.

## Define and register a contribution

A contribution owns one canonical path beneath a registered root section. File and runtime patches use separate schemas so file-only rules, including secret references, can differ from trusted runtime overrides. Patch schemas must not inject defaults; the complete merged value is checked once with `resolvedSchema`.

```ts
import { createConfigRegistry, defineConfigContribution } from "@neottia/config";
import { z } from "zod";

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    token: z.string().optional(),
  })
  .strict();

const resolvedSchema = z
  .object({
    enabled: z.boolean(),
    token: z.string().optional(),
  })
  .strict();

export const exampleConfig = defineConfigContribution({
  id: "example",
  path: ["modules", "example"],
  filePatchSchema: patchSchema,
  runtimePatchSchema: patchSchema,
  resolvedSchema,
  defaults: { enabled: false },
  environment: [
    {
      path: ["enabled"],
      names: ["NEOTTIA_EXAMPLE_ENABLED"],
      kind: "boolean",
    },
  ],
  secrets: [
    {
      path: ["token"],
      fallbackEnvironment: ["NEOTTIA_EXAMPLE_TOKEN"],
    },
  ],
  legacyPaths: [["skills", "example"]],
});

export const registry = createConfigRegistry([exampleConfig]);
```

Environment `names` are ordered from the preferred name to compatibility aliases. Empty values are unset. Secret and environment paths are relative to the contribution shard. `legacyPaths` identify deprecated source locations; snapshots and serialization always use the canonical path.

The configurable root sections are `modules`, `sdlc`, `connections`, `capabilities`, `agents`, `harnesses`, `assets`, and `templates`. `version` and `profiles` are document metadata. Registration rejects invalid metadata, duplicate IDs, exact duplicate paths, ancestor/descendant ownership, and canonical or legacy alias collisions.

## Resolve configuration

`resolveConfig` reads every selected YAML document once and resolves all registered contributions in this order:

1. contribution defaults;
2. global base configuration;
3. project base configuration;
4. the selected global profile;
5. the selected project profile;
6. registered environment bindings;
7. explicit runtime overrides.

Mappings merge recursively. Scalars and arrays replace the lower-precedence value. Every file and profile patch is independently checked before merging, so a valid higher layer cannot hide an invalid lower layer. The final merged shard is checked with its resolved schema.

```ts
import { resolveConfig } from "@neottia/config";
import { exampleConfig, registry } from "./example-config.js";

const snapshot = resolveConfig(registry, {
  cwd: process.cwd(),
  env: process.env,
  profile: "ci",
  overrides: {
    modules: {
      example: { enabled: true },
    },
  },
});

export const config = snapshot.get(exampleConfig);
```

Pass `cwd` for every invocation. Relative explicitly selected files and the default project file resolve from this directory. Pass `env` to isolate resolution from ambient process environment in an embedding application or test.

### File discovery

The default project file is `<cwd>/.neottia/config.yml`. The optional default global file is:

- Linux: `$XDG_CONFIG_HOME/neottia/config.yml`, or `~/.config/neottia/config.yml`;
- macOS: `$XDG_CONFIG_HOME/neottia/config.yml`, or `~/Library/Application Support/neottia/config.yml`;
- Windows: `%APPDATA%\neottia\config.yml`.

`NEOTTIA_GLOBAL_CONFIG_FILE` and `NEOTTIA_CONFIG_FILE` explicitly select the global and project files. `globalFile` and `projectFile` options take precedence; use `false` to disable a source. Missing default files are optional. A missing path selected by an option or environment variable is an error.

### Profiles

Profiles are root-shaped configuration fragments under `profiles.<name>`:

```yaml
version: 1
modules:
  example:
    enabled: false
profiles:
  ci:
    modules:
      example:
        enabled: true
```

`ResolveConfigOptions.profile` takes precedence over `NEOTTIA_PROFILE`. One profile can be selected. A selected profile must exist in at least one loaded document. Global and project fragments with the same name compose in normal precedence order. All declared profiles are validated, including unselected profiles; they cannot introduce unknown sections, `version`, nested `profiles`, or unregistered shards.

### Environment values and secrets

String, integer, and boolean environment bindings are supported. Integers use base-10 safe-integer syntax. Booleans must be exactly `true` or `false`.

A secret in YAML must be one exact environment reference, such as `${EXAMPLE_TOKEN}`. Prefixes, suffixes, and literal file secrets are rejected. Only the winning file reference is resolved, and it is resolved once: if `EXAMPLE_TOKEN` itself contains `${OTHER_TOKEN}`, that text remains literal. Secret fallback environment bindings and explicit runtime overrides may supply trusted literal values.

Typed shard access exposes a secret to its intended consumer. The platform keeps resolved secret values out of diagnostics and provenance, and `snapshot.toJSON()` replaces every declared secret with `[REDACTED]`. Applications must still avoid logging typed shards directly.

### Provenance and diagnostics

`sourceOf` returns value-free leaf metadata. Its path is relative to the contribution shard:

```ts
snapshot.sourceOf(exampleConfig, ["enabled"]);
// {kind: "override", label: "explicit overrides"}
```

Arrays have provenance as complete leaves. Metadata can identify a source kind, file, profile, environment variable name, or deprecated path, but never contains a resolved secret value.

Resolution failures throw `ConfigResolutionError`. Its immutable `diagnostics` cover YAML, version, I/O, path ownership, merge collisions, schemas, profiles, environment coercion, and secrets. Diagnostics report paths and constraints without rejected values and are bounded by `MAX_CONFIG_DIAGNOSTICS`.

## Construct a trusted snapshot directly

An embedding layer with already resolved typed values can use the lower-level snapshot boundary:

```ts
import { createResolvedConfigSnapshot } from "@neottia/config";
import { exampleConfig, registry } from "./example-config.js";

const snapshot = createResolvedConfigSnapshot(registry, {
  example: { enabled: true, token: "runtime-secret" },
});

export const config = snapshot.get(exampleConfig);
```

Omitted shard IDs use contribution defaults. Supplied shards are validated, cloned, and recursively frozen. Snapshot access accepts only a contribution object registered in that snapshot. Direct construction is a trusted runtime boundary: it does not expand secret references, although declared secret paths are still redacted by `toJSON()`.

## License

MIT
