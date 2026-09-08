# Using memory over MCP

The `@neottia/memory-mcp` server exposes the memory tools to **any harness that speaks MCP** — Claude Code, Codex, VS Code Copilot, Kiro, OpenCode, pi, and others — with the same tool names and contracts as every other Neottia surface.

## Tools

| Tool                              | Purpose                                          |
| --------------------------------- | ------------------------------------------------ |
| `memory_store`                    | Save a new fact, decision, event, or lesson      |
| `memory_supersede`                | Correct an existing memory; history is preserved |
| `memory_delete`                   | Retire a memory with a reason                    |
| `memory_get`                      | Fetch one memory by its ULID                     |
| `memory_list`                     | List memories, newest first                      |
| `memory_search`                   | BM25-ranked full-text search                     |
| `memory_validate`                 | Verify canonical files and the search index      |
| `memory_export` / `memory_import` | Move memory between projects (JSONL)             |

Input contracts are validated by Zod schemas and shown to clients as generated JSON Schema in `tools/list`. Full input descriptions live in the [tool contract](./tools) page.

## Wiring per harness

All examples enable memory with namespace `acme/website`. Replace the namespace env vars with your own values, or omit them and rely on a committed `.neottia/config.yml`.

### Claude Code

`.mcp.json` at the repository root:

```json
{
  "mcpServers": {
    "memory": {
      "command": "pnpm",
      "args": ["-y", "@neottia/memory-mcp"],
      "env": {
        "NEOTTIA_MEMORY_ENABLED": "true",
        "NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID": "website"
      }
    }
  }
}
```

### OpenCode

`opencode.json`:

```json
{
  "mcp": {
    "memory": {
      "type": "local",
      "command": ["pnpm", "dlx", "@neottia/memory-mcp"],
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
      "command": "pnpm",
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
command = "pnpm"
args = ["dlx", "@neottia/memory-mcp"]

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
      "command": "pnpm",
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
      "command": "pnpm",
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

The server resolves configuration like every other surface: the `skills.memory` shard of `.neottia/config.yml` in its working directory, overlaid with `NEOTTIA_MEMORY_*` environment variables, over defaults. The `env` blocks above are the primary channel for MCP.

See the [configuration reference](./configuration) for the complete variable table.

## Non-interactive behavior

An MCP server cannot prompt you, so:

- `stale_policy: prompt` is **downgraded to `rebuild`** — a stale index is rebuilt silently from the canonical YAML files, which are always authoritative.
- An explicit `stale_policy: fail` is **respected** — reads return an error telling the agent to run `memory_validate`.
- Secret scanning, resource limits, and the disabled-memory behavior are identical to the library; rejected operations return tool errors with the precise reason.

## Troubleshooting

| Symptom                                           | Cause                                             | Fix                                                                        |
| ------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Every tool returns `…skills.memory.enabled=true…` | Memory disabled                                   | Add `NEOTTIA_MEMORY_ENABLED: "true"` to the server env                     |
| Tools succeed but data is not found later         | Server working directory differs from the project | Launch with the project as `cwd`, or set an absolute `NEOTTIA_MEMORY_ROOT` |
| `no such module: fts5` at startup                 | Node < 22.16 on the host                          | Upgrade Node where the server runs                                         |
| Memories from two branches mix                    | Shared root without scopes                        | Give each workspace its own `NEOTTIA_MEMORY_NAMESPACE_SCOPE`               |

More causes and fixes: [operations troubleshooting](./operations#troubleshooting).
