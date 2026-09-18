# Harness adapter contract

Neottia separates generated content from host-specific paths and configuration formats. The compiler and installer receive a `HarnessAdapter`; they do not branch on Pi or OpenCode.

## Packages

| Package                        | Purpose                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `@neottia/harness-adapter`     | Shared types, immutable result helpers, declaration validation, and adapter registry       |
| `@neottia/pi-adapter`          | Pi paths, prompt metadata, package settings operations, and reload notices                 |
| `@neottia/opencode-adapter`    | OpenCode paths, command and agent metadata, plugin and MCP operations, and restart notices |
| `@neottia/claude-code-adapter` | Claude Code paths, agent metadata, project MCP operations, and restart notices             |

Adapters only return data. They do not read or write files, install packages, execute commands, inspect the current directory, resolve user directories, or authenticate providers. The distribution planner will resolve symbolic paths and apply approved operations.

## Feature support

| Feature                                    | Pi                                          | OpenCode                                  | Claude Code                                  |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| Project and global prompts                 | Supported                                   | Supported as commands                     | Supported as commands                        |
| Project and global skills                  | Supported                                   | Supported                                 | Supported                                    |
| Local extension source                     | Supported                                   | Supported as plugins                      | Unsupported                                  |
| Package activation                         | Supported through `settings.json#/packages` | Supported through `opencode.json#/plugin` | Unsupported                                  |
| Local and remote MCP configuration         | Unsupported                                 | Supported through `opencode.json#/mcp`    | Project-only through `.mcp.json#/mcpServers` |
| Native primary and subagents               | Unsupported                                 | Supported                                 | Supported                                    |
| Prompt description                         | Supported                                   | Supported                                 | Supported                                    |
| Prompt argument hint                       | Supported                                   | Unsupported                               | Supported                                    |
| Prompt agent, model, and subtask selection | Unsupported                                 | Supported                                 | Supported through `context: fork`            |
| Agent step limit                           | Unsupported                                 | Supported                                 | Supported as `maxTurns`                      |
| Portable agent thinking setting            | Unsupported                                 | Unsupported                               | Supported as `effort`                        |

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

Claude Code uses these targets:

| Asset         | Project                        | Global under `home`            |
| ------------- | ------------------------------ | ------------------------------ |
| Command       | `.claude/commands/<id>.md`     | `.claude/commands/<id>.md`     |
| Skill         | `.claude/skills/<id>/SKILL.md` | `.claude/skills/<id>/SKILL.md` |
| Agent         | `.claude/agents/<id>.md`       | `.claude/agents/<id>.md`       |
| Configuration | `.mcp.json`                    | Unsupported                    |

When Claude Code has no project MCP file, the locator creates `.mcp.json`. The adapter does not edit user-managed state such as `~/.claude.json`, so MCP configuration is project-scoped only.

Asset IDs must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. The adapters reject path separators, traversal components, and ambiguous Unicode normalization before producing a target.

## Prompt and skill output

Both adapters preserve an accepted LF-only prompt body after deterministic YAML frontmatter. Pi emits `description` and `argument-hint`. OpenCode emits `description`, `agent`, `model`, and `subtask`. Claude Code emits `description`, `argument-hint`, and `model`, and routes subagent execution through the documented `context: fork` field; an explicit `agent` selection emits both `context` and `agent`. If a request includes metadata that the host cannot represent, projection fails instead of dropping the field.

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

Claude Code accepts the same declarations for project scope only. Local servers become documented `type: "stdio"` entries where the first argv value is `command` and the rest move to `args`; environment values move to `env`. Remote servers become `type: "http"` entries. Both shapes support the documented per-server `timeout` with its 1000 millisecond minimum. The adapter rejects `cwd` and `enabled` because the shared contract has no documented Claude Code representation for them.

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

The result contains an `ensure-object-entry` operation at `/mcp`. It never creates an OAuth token or authentication file. Pi returns an unsupported-feature diagnostic for the same request because Pi has no built-in MCP settings. Claude Code returns an equivalent operation at `/mcpServers` in `.mcp.json` for project scope and a scope diagnostic for global scope.

## Agents

OpenCode agent projection writes Markdown with `description`, `mode`, optional `model`, optional `steps`, and `permission`. New output uses the current `steps` and `permission` fields instead of deprecated agent fields. Claude Code agent projection writes `name`, `description`, optional `model`, optional `effort`, and optional `maxTurns`; the portable permission map has no documented agent-file field and returns a diagnostic. Pi returns an unsupported-feature diagnostic. Later role compilation decides whether a missing native agent is allowed to fall back to current-agent instructions.

OpenCode and Pi reject a portable thinking hint. Claude Code maps the thinking hint to the documented `effort` field, which accepts a bounded level set; unsupported values return a diagnostic. Provider-specific fields are not treated as portable host support.

## Runtime contract

`defineHarnessAdapter()` snapshots the declaration and wraps every method. The wrapper validates decoded request objects before host code runs. It checks that each method returns either one value with no diagnostics or no value with at least one valid diagnostic. Success checks cover symbolic paths, config locators, projected files, package declarations, config plans and operations, and reload notices. Unsafe paths, missing fields, unknown enums, and mismatched host IDs become `INVALID_ADAPTER_RESULT`. Config operation payloads remain opaque after the wrapper checks the operation envelope and required `value` property. The registry applies this wrapper to third-party adapters and does not retain caller-owned declarations, feature records, or version arrays.

All built-in declarations leave `testedHostVersions` empty. Repository tests validate projections and plan shapes without executing a Pi, OpenCode, or Claude Code binary. A version belongs in that array only after a version-coupled host test exercises the adapter.

## Reload notices

Pi resource changes produce a `/reload` notice. Pi package activation produces a restart notice because package installation occurs during startup.

OpenCode changes produce a restart recommendation for deterministic pickup. OpenCode documents startup loading for plugins, package dependencies, and MCP activation, but it does not document one reload command for every asset type. The restart message is Neottia adapter policy, not an OpenCode guarantee.

Claude Code changes also produce a restart recommendation. Claude Code watches skill directories live, but command, agent, and project MCP changes do not document a universal reload command. The restart message is Neottia adapter policy, not a Claude Code guarantee.

## Review and application

`HostConfigPlan` supports two semantic operations:

- `ensure-array-entry` for package activation
- `ensure-object-entry` for named MCP servers

Each operation has a stable ID and `owner: "neottia"`. The future installer must parse the selected host file, preserve unrelated entries, show the operation for review, and apply it only under its ownership rules. Adapters do not implement those steps.
