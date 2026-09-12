# Generic MCP servers

Neottia ships three stdio servers. Start each process in the project directory whose `.neottia/config.yml` and canonical files it should use.

| Capability  | Command                             | Tools |
| ----------- | ----------------------------------- | ----: |
| Memory      | `pnpm dlx @neottia/memory-mcp`      |     9 |
| Issues      | `pnpm dlx @neottia/issues-mcp`      |    17 |
| Design Docs | `pnpm dlx @neottia/design-docs-mcp` |    13 |

## Generic client pattern

Clients that use `mcpServers` can launch Memory like this:

```json
{ "mcpServers": { "neottia-memory": { "command": "pnpm", "args": ["dlx", "@neottia/memory-mcp"] } } }
```

Replace the server name and package for Issues or Design Docs. Keep the client process working directory at the project root.

## OpenCode MCP configuration

OpenCode accepts a local command array in `opencode.json`:

```json
{ "mcp": { "neottia-memory": { "type": "local", "command": ["pnpm", "dlx", "@neottia/memory-mcp"], "enabled": true } } }
```

OpenCode also has [native Neottia plugins](/harnesses/opencode). Choose either the native plugin or generic MCP package for a capability, not both.

## Pi MCP configuration

Pi accepts a project `.pi/mcp.json` entry:

```json
{ "mcpServers": { "neottia-memory": { "command": "pnpm", "args": ["dlx", "@neottia/memory-mcp"] } } }
```

Pi users should normally choose the [native extensions](/harnesses/pi), which provide Pi confirmation behavior. The generic MCP process remains non-interactive.

All three servers advertise `{tools: {}}` and implement `tools/list` and `tools/call`. They expose no MCP resources or prompts. Keep logs off stdout because stdout carries MCP frames. Stop the client cleanly so it closes the server and its cached domain context.

The servers are non-interactive. A stale `prompt` policy rebuilds; `fail` still fails. See the [Memory](/mcp/memory), [Issues](/mcp/issues), and [Design Docs](/mcp/design-docs) server pages.
