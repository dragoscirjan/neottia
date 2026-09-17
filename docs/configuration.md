# Configuration

Neottia reads one versioned YAML configuration for Memory, Issues, Design Docs, and Searchable. The shared resolver validates the whole file and returns one immutable snapshot. Each module reads its shard from that snapshot.

## Editor schema

`@neottia/config` publishes the complete schema at `@neottia/config/config.schema.json`. It includes every supported `modules.*` field and profile fragment. Unknown root, module, and module setting keys fail validation.

Point a YAML language server at the installed schema. A project file at `.neottia/config.yml` can use this relative path when `node_modules` is in the project root:

```yaml
# yaml-language-server: $schema=../node_modules/@neottia/config/config.schema.json
version: 1
modules: {}
```

The source repository also publishes [`packages/config/config.schema.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/config/config.schema.json).

## Configuration files

The project file is `<cwd>/.neottia/config.yml`. Neottia resolves `<cwd>` from the host invocation, so separate Git worktrees can use separate project files.

The optional global file depends on the operating system:

| System  | Default global file                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------- |
| Linux   | `$XDG_CONFIG_HOME/neottia/config.yml`, otherwise `~/.config/neottia/config.yml`                     |
| macOS   | `$XDG_CONFIG_HOME/neottia/config.yml`, otherwise `~/Library/Application Support/neottia/config.yml` |
| Windows | `%APPDATA%\neottia\config.yml`                                                                      |

Set `NEOTTIA_GLOBAL_CONFIG_FILE` or `NEOTTIA_CONFIG_FILE` to select a different global or project file. A relative selected path resolves against the invocation working directory. Default files are optional. A path selected through an environment variable or resolver option must exist.

Each file must be a regular file no larger than 1 MiB. YAML can contain at most 10,000 scalar and collection nodes with a maximum collection depth of 64. Files above these limits fail with a `LIMIT` diagnostic before the resolver converts YAML to JavaScript values.

Every present file must have the exact integer `version: 1`. The supported root keys are `version`, `modules`, `sdlc`, `connections`, `capabilities`, `agents`, `harnesses`, `assets`, `templates`, and `profiles`. A root section can contain only registered paths. The current published schema registers the paths below.

| Module      | Canonical path        | Module reference                                                                                                 |
| ----------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Memory      | `modules.memory`      | [Memory configuration](./memory/configuration.md)                                                                |
| Issues      | `modules.issues`      | [Issues configuration](./issues/configuration.md)                                                                |
| Design Docs | `modules.design_docs` | [Design Docs package guide](https://github.com/dragoscirjan/neottia/blob/main/packages/design-docs/README.md)    |
| Searchable  | `modules.searchable`  | [Searchable package guide](https://github.com/dragoscirjan/neottia/blob/main/packages/searchable-core/README.md) |

| SDLC selection     | Canonical path                | Reference                                           |
| ------------------ | ----------------------------- | --------------------------------------------------- |
| Issues provider    | `capabilities.issues`         | [SDLC provider selection](#sdlc-provider-selection) |
| Documents provider | `capabilities.documents`      | [SDLC provider selection](#sdlc-provider-selection) |
| Source control     | `capabilities.source_control` | [SDLC provider selection](#sdlc-provider-selection) |

| Provider connection | Canonical path       | Reference                                           |
| ------------------- | -------------------- | --------------------------------------------------- |
| Forge connections   | `connections.forges` | [Forge provider configuration](./sdlc/providers.md) |

| Distribution setting | Canonical path      | Reference                             |
| -------------------- | ------------------- | ------------------------------------- |
| Harness targets      | `harnesses.install` | [Asset distribution](./distribution/) |
| Static skills        | `assets.install`    | [Asset distribution](./distribution/) |
| Template sources     | `templates.install` | [Asset distribution](./distribution/) |

## Distribution configuration

Installation inputs are explicit. Neottia does not scan installed packages or infer targets from files already on disk.

```yaml
version: 1
harnesses:
  install:
    targets:
      - id: pi
        scope: project
assets:
  install:
    static_skills: []
templates:
  install:
    packages: []
    global_overrides: []
    project_overrides: []
```

`harnesses.install.targets` selects one harness ID and scope per output. `assets.install.static_skills` requires an exact revision and SHA-256 digest. Template package and override entries require an explicit ID, manifest path, and version. These values feed compilation and staging; configuration resolution does not install assets or execute external tools.

## Project example

This file enables all migrated modules. Omitted settings use module defaults. The module references above list every environment binding and setting.

```yaml
version: 1
modules:
  memory:
    enabled: true
    root: .neottia/memory
    backend: filesystem
    namespace:
      organization_id: acme
      project_id: storefront
      default_topic: general
      scope: global
    retrieval:
      limit: 8
      max_chars: 12000
      include_superseded: false
    cache:
      max_age_ms: 300000
      stale_policy: prompt

  issues:
    enabled: true
    root: .neottia/issues
    prefix: issue-
    retrieval:
      limit: 20
      max_bytes: 1048576
    cache:
      max_age_ms: 300000
      stale_policy: prompt
    lock:
      wait_ms: 10000
      stale_ms: 60000

  design_docs:
    enabled: true
    root: .neottia/design-docs
    retrieval:
      limit: 20
      snippet_bytes: 512
      all_versions: false
    cache:
      max_age_ms: 300000
      stale_policy: prompt

  searchable:
    enabled: true
    root: .neottia/searchable
    search:
      provider: google
      limit: 5
      credentials:
        google_api_key: ${GOOGLE_API_KEY}
        google_cse_id: ${GOOGLE_CSE_ID}
    fetch:
      strategies: [direct, jina, wayback]
      timeout_ms: 10000
      overall_timeout_ms: 20000
      max_response_bytes: 10485760
    grep:
      limit: 5
      snippet_bytes: 512
    ask:
      limit: 3
      context_bytes: 131072
    ollama:
      endpoint: http://localhost:11434
      model: llama3
      timeout_ms: 60000
    cache:
      max_age_ms: 300000
      stale_policy: prompt
```

Memory's PostgreSQL backend accepts `provider.db.pg` settings. Issues, Design Docs, Memory, and Searchable also have resource limits under their `security` settings. Design Docs roots accept portable Unicode directory names while reserving the actual `.neottia/cache` and `.neottia/repository-store` paths. Use editor completion from the complete schema or the linked module reference when setting those limits.

## SDLC provider selection

`@neottia/sdlc` adds compile-time provider choices to the same snapshot. The defaults select filesystem Issues, filesystem Documents, local Git, no remote source control, and no Git workspaces.

Filesystem providers use the corresponding module settings. Enable both modules before creating compiler input:

```yaml
version: 1
modules:
  issues:
    enabled: true
  design_docs:
    enabled: true
capabilities:
  issues:
    provider: filesystem
  documents:
    provider: filesystem
  source_control:
    local: git
    remote: false
    workspaces: false
```

Remote names reserve stable compiler selections for provider instruction packages. Selecting a name does not install instructions, authenticate a provider, or grant access.

| Capability            | Accepted selections                                                | Delivery status                                                                                      |
| --------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Issues                | `filesystem`, `github`, `gitlab`, `gitea`, `forgejo`, `jira`       | Filesystem and the four forge bundles are available. Gitea and Forgejo require MCP. Jira is planned. |
| Documents             | `filesystem`, `github`, `gitlab`, `gitea`, `forgejo`, `confluence` | Filesystem, GitHub, and GitLab are available. Gitea and Forgejo are rejected. Confluence is planned. |
| Local source control  | `git`, `jj`                                                        | Git instructions are available. Jujutsu is planned.                                                  |
| Remote source control | `false`, `github`, `gitlab`, `gitea`, `forgejo`, `bitbucket`       | The four forge bundles are available. Gitea and Forgejo require MCP. Bitbucket is planned.           |

`remote` is one scalar. Set it to `false` or one supported forge:

```yaml
version: 1
capabilities:
  issues:
    provider: jira
  documents:
    provider: confluence
  source_control:
    local: jj
    remote: bitbucket
    workspaces: false
```

The scalar remote selection replaces atomically across global, project, and profile layers. A profile can set `remote: false` without retaining a lower provider.

A selected forge also needs a strict `connections.forges.<provider>` entry. The entry stores an HTTP or HTTPS base URL and the name of a credential environment variable. HTTP connections also require `allow_insecure_http: true`; HTTPS connections omit that field. Optional MCP entries use strict `{server, command}` pairs for `issues`, `documents`, or `remote_source_control`. Configuration stores names only, never token values.

```yaml
version: 1
capabilities:
  issues:
    provider: github
  documents:
    provider: github
  source_control:
    local: git
    remote: github
    workspaces: true
connections:
  forges:
    github:
      base_url: https://github.com
      credential_environment: GITHUB_TOKEN
```

Git workspaces require `local: git`. `createSdlcCompilerContext(snapshot)` also rejects a missing selected connection, an unsupported forge capability, or a missing required Gitea or Forgejo MCP service. It reports typed, value-free `SdlcConfigError` problems, reads only the supplied snapshot, and returns a deeply frozen context.

Read [forge provider configuration](./sdlc/providers.md) for the support matrix, self-hosted URLs, CLI and MCP setup, authentication, mutation safety, and troubleshooting.

`loadSdlcTemplateLayers()` reads the six published `.md.twig` templates and complete command overrides from `.neottia/templates/sdlc/<command>.md.twig`. It rejects unknown command filenames. Pass its result to `createSdlcCompilerInput()`, which adds resolved template, instruction, role, configuration, and runtime package provenance. `compileSdlc()` then projects the canonical six-command lifecycle through a Pi or OpenCode adapter. Runtime package IDs and exact versions are separate compiler inputs. The compiler never infers packages from provider selections. See [the SDLC compiler guide](./sdlc/) for the complete input, output, and installation handoff.

## Profiles

A profile is a root-shaped fragment under `profiles.<name>`. It may change registered module settings, but it cannot contain `version`, another `profiles` mapping, or an unknown path.

```yaml
version: 1
modules:
  memory:
    enabled: true
    cache:
      stale_policy: prompt
  issues:
    enabled: true

profiles:
  ci:
    modules:
      memory:
        cache:
          stale_policy: fail
      issues:
        cache:
          stale_policy: fail
      design_docs:
        cache:
          stale_policy: fail
```

Select one profile with `NEOTTIA_PROFILE`. An embedding application can instead pass the resolver's `profile` option, which takes precedence over `NEOTTIA_PROFILE`. The selected name must exist in at least one loaded file. If the global and project files both define that name, the resolver applies both fragments. Neottia validates unselected profiles too, so an unused invalid profile still fails.

Profiles do not inherit from other profiles. There is no implicit default profile and no list of active profiles.

## Precedence and merging

Neottia applies sources in this order, from lowest to highest precedence:

1. Module defaults.
2. Global base configuration.
3. Project base configuration.
4. The selected profile in the global file.
5. The selected profile in the project file.
6. Registered environment bindings.
7. Explicit runtime overrides.

Mappings merge by key. Scalars and arrays replace the lower value. `null` has no deletion meaning and normally fails the module schema. Each file and profile fragment must pass its own schema before merging. A later valid value cannot hide an invalid value in an earlier source.

For example, this global mapping and project mapping retain `limit: 10` while replacing `stale_policy`:

```yaml
# Global file
version: 1
modules:
  issues:
    retrieval:
      limit: 10
    cache:
      stale_policy: prompt
```

```yaml
# Project file
version: 1
modules:
  issues:
    cache:
      stale_policy: fail
```

## Secrets

YAML secret fields must contain one exact environment reference in the form `${ENV_VAR}`. Do not add prefixes, suffixes, or literal credentials.

```yaml
version: 1
modules:
  memory:
    backend: postgres
    provider:
      db:
        pg:
          user: ${NEOTTIA_DATABASE_USER}
          password: ${NEOTTIA_DATABASE_PASSWORD}
  searchable:
    search:
      credentials:
        brave_api_key: ${BRAVE_API_KEY}
```

The resolver expands only the winning file or profile reference. It expands that reference once. If the selected environment value is `${SECOND_VAR}`, the module receives that text rather than the value of `SECOND_VAR`. An absent or empty referenced variable causes a `SECRET` diagnostic.

Registered environment bindings and explicit runtime overrides may pass trusted literal secrets. `snapshot.toJSON()` replaces every declared secret with `[REDACTED]`. Provenance and diagnostics do not contain resolved secret values. Typed shard access must expose a credential to the module that uses it, so applications must not log typed shards.

## Provenance and diagnostics

An embedding application can ask which source supplied a leaf. `sourceOf` accepts a module contribution and a path relative to that module's shard:

```ts
snapshot.sourceOf(issueConfigContribution, ["cache", "stale_policy"]);
// Returns {kind: "profile", file: "/repo/.neottia/config.yml", profile: "ci"}.
```

Provenance can name the source kind, file, profile, environment variable, deprecated source path, or runtime override label. Arrays have one source for the complete array.

Resolution failures throw `ConfigResolutionError`. Its `diagnostics` array uses these codes:

| Code          | Meaning                                                               |
| ------------- | --------------------------------------------------------------------- |
| `YAML`        | The document is malformed, ambiguous, or has duplicate mapping keys.  |
| `VERSION`     | `version` is absent or is not the integer `1`.                        |
| `IO`          | An explicitly selected file is absent or unreadable.                  |
| `PATH`        | A root or shard path is not registered.                               |
| `MERGE`       | One source declares canonical and deprecated paths for one module.    |
| `SCHEMA`      | A module setting does not satisfy its file or runtime schema.         |
| `PROFILE`     | A profile name or fragment is invalid.                                |
| `ENVIRONMENT` | An environment value cannot be converted to its declared type.        |
| `SECRET`      | A file secret is literal or its referenced variable is not populated. |
| `LIMIT`       | More diagnostics occurred than the published bound permits.           |

A diagnostic contains structural paths and source metadata, not rejected values. Neottia returns at most `MAX_CONFIG_DIAGNOSTICS` records.

## Declared and host-effective settings

The resolved snapshot records declared configuration. A host may derive another snapshot for runtime policy without changing the declared snapshot or rereading files. Current non-interactive MCP and OpenCode hosts convert `cache.stale_policy: prompt` to `rebuild`. Pi keeps `prompt` because it can ask the user. An explicit `fail` remains `fail`.

When behavior differs from the YAML file, inspect the effective host and its override provenance. Do not treat a host policy override as a persisted setting.

## Embedding

Neottia hosts can resolve the complete official registry directly:

```ts
import { resolveHostConfigSnapshot } from "@neottia/config-registry";

export const snapshot = resolveHostConfigSnapshot({
  cwd: process.cwd(),
  interactive: true,
});
```

Custom applications can register only the modules they own, then resolve once for the effective working directory:

```ts
import { createConfigRegistry, resolveConfig } from "@neottia/config";
import { designDocsConfigContribution } from "@neottia/design-docs";
import { issueConfigContribution, IssueStore } from "@neottia/issues";
import { memoryConfigContribution, MemoryStore } from "@neottia/memory-core";
import { searchableConfigContribution } from "@neottia/searchable-core";

const registry = createConfigRegistry([
  memoryConfigContribution,
  issueConfigContribution,
  designDocsConfigContribution,
  searchableConfigContribution,
]);
const cwd = process.cwd();
const snapshot = resolveConfig(registry, { cwd, env: process.env });

await MemoryStore.fromConfig(snapshot.get(memoryConfigContribution), cwd);
new IssueStore(snapshot.get(issueConfigContribution), cwd);
```

Pass `env` when the application needs isolation from ambient process variables. Pass root-shaped `overrides` for trusted runtime values. Keep one snapshot for operations that combine Issues and Design Docs so both modules observe the same files, profile, environment, and working directory.

Applications with already resolved typed settings can skip file loading:

```ts
createResolvedConfigSnapshot(registry, {
  issues: explicitIssueConfig,
  memory: explicitMemoryConfig,
});
```

Direct construction validates, clones, and freezes each supplied shard. Missing shard IDs use contribution defaults. It does not expand environment references.

## Migrating `skills.*`

Move each module mapping under `modules` without changing its fields:

```yaml
# Before
version: 1
skills:
  memory:
    enabled: true
  issues:
    enabled: true
  design_docs:
    enabled: true
  searchable:
    enabled: true
```

```yaml
# After
version: 1
modules:
  memory:
    enabled: true
  issues:
    enabled: true
  design_docs:
    enabled: true
  searchable:
    enabled: true
```

The standalone loaders temporarily accept these aliases:

| Deprecated path      | Canonical path        | Standalone loader        |
| -------------------- | --------------------- | ------------------------ |
| `skills.memory`      | `modules.memory`      | `loadMemoryConfig()`     |
| `skills.issues`      | `modules.issues`      | `loadIssueConfig()`      |
| `skills.design_docs` | `modules.design_docs` | `loadDesignDocsConfig()` |
| `skills.searchable`  | `modules.searchable`  | `loadSearchableConfig()` |

Do not declare both the deprecated and canonical path for one module in the same file or profile. The resolver reports a `MERGE` diagnostic instead of choosing one. Shared hosts use canonical paths and strict root validation. Module-specific file selectors and arbitrary shard-path environment variables remain only in deprecated standalone wrappers.

An existing Issues and Design Docs composition no longer reloads one module during an operation. It stays pinned to one snapshot. Resolve a new snapshot to observe file changes.
