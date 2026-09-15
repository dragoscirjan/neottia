# Harness adapter contract

Neottia separates generated content from host-specific paths and configuration formats. The compiler and installer receive a `HarnessAdapter`; they do not branch on Pi or OpenCode.

## Packages

| Package                     | Purpose                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `@neottia/harness-adapter`  | Shared types, immutable result helpers, declaration validation, and adapter registry       |
| `@neottia/pi-adapter`       | Pi paths, prompt metadata, package settings operations, and reload notices                 |
| `@neottia/opencode-adapter` | OpenCode paths, command and agent metadata, plugin and MCP operations, and restart notices |

Adapters only return data. They do not read or write files, install packages, execute commands, inspect the current directory, resolve user directories, or authenticate providers. The distribution planner will resolve symbolic paths and apply approved operations.

## Feature support

| Feature                                    | Pi                                          | OpenCode                                  |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------- |
| Project and global prompts                 | Supported                                   | Supported as commands                     |
| Project and global skills                  | Supported                                   | Supported                                 |
| Local extension source                     | Supported                                   | Supported as plugins                      |
| Package activation                         | Supported through `settings.json#/packages` | Supported through `opencode.json#/plugin` |
| Local and remote MCP configuration         | Unsupported                                 | Supported through `opencode.json#/mcp`    |
| Native primary and subagents               | Unsupported                                 | Supported                                 |
| Prompt description                         | Supported                                   | Supported                                 |
| Prompt argument hint                       | Supported                                   | Unsupported                               |
| Prompt agent, model, and subtask selection | Unsupported                                 | Supported                                 |
| Agent step limit                           | Unsupported                                 | Supported                                 |
| Portable agent thinking setting            | Unsupported                                 | Unsupported                               |

Unsupported requests return typed diagnostics and no projected file or configuration operation. Neottia does not emulate missing host features with generated extensions.

## Symbolic paths

A `TargetPath` has an anchor and safe path segments. The available anchors are `project`, `home`, and `xdg-config`. The installer supplies the absolute value for each anchor.

Pi uses these targets:

| Asset     | Project                    | Global under `home`              |
| --------- | -------------------------- | -------------------------------- |
| Prompt    | `.pi/prompts/<id>.md`      | `.pi/agent/prompts/<id>.md`      |
| Skill     | `.pi/skills/<id>/SKILL.md` | `.pi/agent/skills/<id>/SKILL.md` |
| Extension | `.pi/extensions/<id>.ts`   | `.pi/agent/extensions/<id>.ts`   |
| Settings  | `.pi/settings.json`        | `.pi/agent/settings.json`        |

OpenCode uses these targets:

| Asset         | Project                             | Global under `xdg-config`                             |
| ------------- | ----------------------------------- | ----------------------------------------------------- |
| Command       | `.opencode/commands/<id>.md`        | `opencode/commands/<id>.md`                           |
| Skill         | `.opencode/skills/<id>/SKILL.md`    | `opencode/skills/<id>/SKILL.md`                       |
| Plugin        | `.opencode/plugins/<id>.ts`         | `opencode/plugins/<id>.ts`                            |
| Agent         | `.opencode/agents/<id>.md`          | `opencode/agents/<id>.md`                             |
| Configuration | `opencode.json` or `opencode.jsonc` | `opencode/opencode.json` or `opencode/opencode.jsonc` |

When OpenCode has no configuration file, the locator selects the `.json` candidate for creation. The installer must detect existing `.json` and `.jsonc` files before it applies a plan.

Asset IDs must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. The adapters reject path separators, traversal components, and ambiguous Unicode normalization before producing a target.

## Prompt and skill output

Both adapters preserve an accepted LF-only prompt body after deterministic YAML frontmatter. Pi emits `description` and `argument-hint`. OpenCode emits `description`, `agent`, `model`, and `subtask`. If a request includes metadata that the host cannot represent, projection fails instead of dropping the field.

Both adapters produce the same `SKILL.md` bytes for the same skill request. Skill names use the safe asset ID format and cannot exceed 64 characters. Descriptions cannot exceed 1024 characters. Optional compatibility text must contain non-whitespace text and cannot exceed 500 characters. Optional licenses must contain non-whitespace text. Metadata keys must contain non-whitespace text, and metadata values must be strings.

## Package plans

Call `declarePackage()` with a logical module ID and exact version. The adapter owns the package-name mapping.

```ts
adapter.declarePackage({
  logicalId: "issues",
  scope: "project",
  version: "1.2.3",
});
```

Pi maps this request to `@neottia/pi-issues`. OpenCode maps it to `@neottia/opencode-issues`. `planHostConfiguration()` then returns one `ensure-array-entry` operation with a stable package identity. It does not return a replacement settings document.

The four supported logical IDs are `memory`, `issues`, `design-docs`, and `searchable`. Versions must be exact SemVer 2 values. Prerelease and build metadata are accepted, while numeric components with forbidden leading zeroes are rejected.

## MCP plans

OpenCode accepts local and remote MCP declarations. Local commands remain arrays so no shell parsing is introduced. Environment and header values remain strings such as `{env:API_TOKEN}`; the adapter does not resolve them.

```ts
opencodeHarnessAdapter.planHostConfiguration({
  kind: "mcp.remote",
  scope: "global",
  server: {
    name: "company-docs",
    url: "https://mcp.example.com",
    headers: { Authorization: "Bearer {env:DOCS_TOKEN}" },
    oauth: false,
  },
});
```

The result contains an `ensure-object-entry` operation at `/mcp`. It never creates an OAuth token or authentication file. Pi returns an unsupported-feature diagnostic for the same request because Pi has no built-in MCP settings.

## Agents

OpenCode agent projection writes Markdown with `description`, `mode`, optional `model`, optional `steps`, and `permission`. New output uses the current `steps` and `permission` fields instead of deprecated agent fields. Pi returns an unsupported-feature diagnostic. Later role compilation decides whether a missing native agent is allowed to fall back to current-agent instructions.

Neither adapter accepts a portable thinking hint. Provider-specific fields are not treated as portable host support.

## Runtime contract

`defineHarnessAdapter()` snapshots the declaration and wraps every method. The wrapper validates decoded request objects before host code runs. It checks that each method returns either one value with no diagnostics or no value with at least one valid diagnostic. Success checks cover symbolic paths, config locators, projected files, package declarations, config plans and operations, and reload notices. Unsafe paths, missing fields, unknown enums, and mismatched host IDs become `INVALID_ADAPTER_RESULT`. Config operation payloads remain opaque after the wrapper checks the operation envelope and required `value` property. The registry applies this wrapper to third-party adapters and does not retain caller-owned declarations, feature records, or version arrays.

Both built-in declarations leave `testedHostVersions` empty. Repository tests validate projections and plan shapes without executing a Pi or OpenCode binary. A version belongs in that array only after a version-coupled host test exercises the adapter.

## Reload notices

Pi resource changes produce a `/reload` notice. Pi package activation produces a restart notice because package installation occurs during startup.

OpenCode changes produce a restart recommendation for deterministic pickup. OpenCode documents startup loading for plugins, package dependencies, and MCP activation, but it does not document one reload command for every asset type. The restart message is Neottia adapter policy, not an OpenCode guarantee.

## Review and application

`HostConfigPlan` supports two semantic operations:

- `ensure-array-entry` for package activation
- `ensure-object-entry` for named MCP servers

Each operation has a stable ID and `owner: "neottia"`. The future installer must parse the selected host file, preserve unrelated entries, show the operation for review, and apply it only under its ownership rules. Adapters do not implement those steps.
