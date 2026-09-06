# @neottia/memory-mcp

MCP stdio server exposing the Neottia memory tools. Tool names, descriptions, and input contracts are identical to the pi/OpenCode in-process extensions (source: [`@neottia/memory-core`](../memory-core)).

## Usage

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@neottia/memory-mcp"],
      "env": {
        "NEOTTIA_MEMORY_ENABLED": "true",
        "NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID": "my-project"
      }
    }
  }
}
```

Tools: `memory_store`, `memory_supersede`, `memory_delete`, `memory_get`, `memory_list`, `memory_search`, `memory_validate`, `memory_export`, `memory_import`.

The server is non-interactive: a `stale_policy: prompt` in the config shard is downgraded to `rebuild`; an explicit `fail` is respected.

Requires Node.js >= 22.16.0. MIT — see [LICENSE](./LICENSE).
