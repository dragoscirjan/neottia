# @neottia/memory-mcp

Generic stdio MCP server for the nine Memory tools. It requires Node.js 22.16 or newer and the selected Memory backend's platform requirements.

```sh
pnpm dlx @neottia/memory-mcp
```

Run it from the project CWD after enabling `skills.memory`. Use MCP `tools/list` to verify nine `memory_*` tools, then call `memory_store`. The server is non-interactive, fixes CWD at startup, exposes tools but no resources or prompts, and closes Memory when `server.close()` runs. Object-root results may use structured content; lists and exports are text-only. Errors are plain text, and request cancellation is not currently forwarded.

The filesystem backend ignores `namespace.scope`; separate worktrees stay isolated through separate filesystem roots. Namespace scope separates PostgreSQL rows within one organization and project.

Read the [Memory MCP guide](https://github.com/dragoscirjan/neottia/blob/main/docs/mcp/memory.md).
