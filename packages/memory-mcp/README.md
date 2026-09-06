# @neottia/memory-mcp

MCP server that exposes **Neottia's project memory** to any AI coding harness that speaks the Model Context Protocol: Claude Code, Codex, VS Code Copilot, Kiro, OpenCode, pi, and anything else MCP-compatible.

It wires the nine `memory_*` tools — store, supersede, delete, get, list, search, validate, export, import — with **identical names, descriptions, and input contracts** across every harness. The JSON Schema shown to your agent in `tools/list` is generated from the same Zod models that validate the input, so the advertised contract and the enforced contract can never drift.

Memory itself is stored as reviewable YAML files inside your project (git-diffable, auditable) with a SQLite BM25 index. See [`@neottia/memory-core`](../memory-core) for the full storage and configuration model.

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Wiring it into your harness](#wiring-it-into-your-harness)
  - [Claude Code](#claude-code)
  - [OpenCode](#opencode)
  - [pi](#pi)
  - [Codex](#codex)
  - [Kiro](#kiro)
  - [VS Code (Copilot)](#vs-code-copilot)
- [Configuration](#configuration)
- [Non-interactive behavior](#non-interactive-behavior)
- [Tools](#tools)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Requirements

- **Node.js >= 22.16.0** on the machine (and CI) where the server runs — the first Node release whose built-in `node:sqlite` ships with FTS5.
- A project directory where memory files may be written.

## Quick start

The fastest test with no project configuration at all:

```bash
NEOTTIA_MEMORY_ENABLED=true npx -y @neottia/memory-mcp
```

The server speaks MCP over stdio. Point your harness at it (examples below), then ask your agent:

> "Remember that this project deploys with pnpm, never npm."

The agent calls `memory_store`, and a YAML file appears under `.neottia/memory/facts/` — ready to review and commit.

## Wiring it into your harness

All examples enable memory with the `acme/website` namespace. Adjust the namespace env vars to your project, or skip them entirely and use a `.neottia/config.yml` file instead (see [Configuration](#configuration)).

### Claude Code

Project scope — `.mcp.json` at the repository root (shared with the team through git):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@neottia/memory-mcp"],
      "env": {
        "NEOTTIA_MEMORY_ENABLED": "true",
        "NEOTTIA_MEMORY_NAMESPACE_ORGANIZATION_ID": "acme",
        "NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID": "website"
      }
    }
  }
}
```

### OpenCode

`opencode.json` (project root) or `~/.config/opencode/opencode.json` (global):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "memory": {
      "type": "local",
      "command": ["npx", "-y", "@neottia/memory-mcp"],
      "environment": {
        "NEOTTIA_MEMORY_ENABLED": "true",
        "NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID": "website"
      },
      "enabled": true
    }
  }
}
```

### pi

`~/.pi/agent/mcp.json` (global) or `.pi/mcp.json` (project):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@neottia/memory-mcp"],
      "env": {
        "NEOTTIA_MEMORY_ENABLED": "true",
        "NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID": "website"
      }
    }
  }
}
```

### Codex

`~/.codex/config.toml` (global) or `.codex/config.toml` (project):

```toml
[mcp_servers.memory]
command = "npx"
args = ["-y", "@neottia/memory-mcp"]

[mcp_servers.memory.env]
NEOTTIA_MEMORY_ENABLED = "true"
NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID = "website"
```

### Kiro

`.kiro/settings/mcp.json` (workspace) or the user MCP config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@neottia/memory-mcp"],
      "env": {
        "NEOTTIA_MEMORY_ENABLED": "true",
        "NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID": "website"
      },
      "disabled": false
    }
  }
}
```

### VS Code (Copilot)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@neottia/memory-mcp"],
      "env": {
        "NEOTTIA_MEMORY_ENABLED": "true",
        "NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID": "website"
      }
    }
  }
}
```

## Configuration

The server resolves configuration exactly like the library: the `skills.memory` shard of `.neottia/config.yml` in its working directory (which is your harness's project directory), overlaid with `NEOTTIA_*` environment variables, over built-in defaults.

The `env` blocks in the examples above are the primary configuration channel for MCP — they carry the same variables as every other Neottia surface:

| Variable                                   | Purpose                                                     | Default                                     |
| ------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------- |
| `NEOTTIA_MEMORY_ENABLED`                   | Master switch — the server refuses operations while `false` | `false`                                     |
| `NEOTTIA_MEMORY_NAMESPACE_ORGANIZATION_ID` | Organization namespace                                      | `local`                                     |
| `NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID`      | Project namespace                                           | `project`                                   |
| `NEOTTIA_MEMORY_NAMESPACE_SCOPE`           | Shard scope (branch/workspace)                              | `global`                                    |
| `NEOTTIA_MEMORY_ROOT`                      | Memory storage root                                         | `.neottia/memory`                           |
| `NEOTTIA_MEMORY_RETRIEVAL_LIMIT`           | Default result count                                        | `8`                                         |
| `NEOTTIA_MEMORY_CACHE_STALE_POLICY`        | Stale-index behavior                                        | `prompt` → **downgraded to `rebuild` here** |
| `NEOTTIA_MEMORY_CACHE_MAX_AGE_MS`          | Index freshness window                                      | `300000`                                    |

The full table, including config-file paths and Postgres connection variables, is documented in [`@neottia/memory-core`](../memory-core#environment-variable-reference).

### A file-and-env split that works well

Keep the shared settings in the committed config file and only the identity in env vars:

```yaml
# .neottia/config.yml (committed)
version: 1
skills:
  memory:
    enabled: true
    namespace:
      organization_id: acme
      project_id: website
```

```json
{ "env": { "NEOTTIA_MEMORY_NAMESPACE_SCOPE": "${branch}" } }
```

## Non-interactive behavior

An MCP server cannot ask questions, so the interactive behaviors of the library are resolved automatically:

- **Stale search index**: `stale_policy: prompt` is downgraded to `rebuild` (a silent rebuild from the canonical YAML files, which are always authoritative). An explicit `fail` is respected — the server returns an error telling the agent to run `memory_validate`.
- **Secret scanning and limits**: identical to the library; a rejected write returns a tool error with the precise reason (`Suspected secret at $.summary…`).
- **Disabled memory**: every tool returns a `Memory operation requires skills.memory.enabled=true…` error instead of silently doing nothing.

## Tools

| Tool                              | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `memory_store`                    | Save a new fact, decision, event, or lesson                             |
| `memory_supersede`                | Correct an existing memory; history is preserved                        |
| `memory_delete`                   | Retire a memory with a reason (tombstone; nothing is deleted from disk) |
| `memory_get`                      | Fetch one memory by its ULID                                            |
| `memory_list`                     | List memories, newest first                                             |
| `memory_search`                   | BM25-ranked full-text search                                            |
| `memory_validate`                 | Verify canonical files and the search index                             |
| `memory_export` / `memory_import` | Move memory between projects (JSONL, with a validating preview mode)    |

Full input and return descriptions: the [tool contract](https://github.com/dragoscirjan/neottia/blob/main/docs/memory/tools.md) page and the [`memory-core` API reference](https://github.com/dragoscirjan/neottia/blob/main/packages/memory-core/README.md).

## Troubleshooting

| Symptom                                           | Cause                                                    | Fix                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Every tool returns `…skills.memory.enabled=true…` | Memory disabled                                          | Add `NEOTTIA_MEMORY_ENABLED: "true"` to the server env or enable it in the config file                         |
| Tools succeed but nothing is found later          | The server's working directory differs from your project | Check that the harness launches the server with the project as `cwd`, or set an absolute `NEOTTIA_MEMORY_ROOT` |
| `Cannot open memory index` repeatedly             | Broken index that cannot be rebuilt                      | Delete `.neottia/memory/index.db`; it is rebuilt from YAML                                                     |
| `no such module: fts5` at startup                 | Node < 22.16 running the server                          | Upgrade Node on the host that spawns the server                                                                |
| Memories from two branches mix                    | Shared root without scopes                               | Give each workspace its own `NEOTTIA_MEMORY_NAMESPACE_SCOPE`                                                   |

## License

MIT — see [LICENSE](./LICENSE). Part of [Neottia](https://github.com/dragoscirjan/neottia).
