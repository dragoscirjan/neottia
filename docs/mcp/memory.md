# Memory MCP server

`@neottia/memory-mcp` requires Node.js 22.16 or newer and inherits the selected [Memory backend requirements](/memory/backends). Launch it from the project directory:

```sh
pnpm dlx @neottia/memory-mcp
```

Enable `skills.memory` in `.neottia/config.yml`, then call `tools/list`. The result must contain the nine names in the [Memory tool reference](/memory/tools). Call `memory_store` with the [first-success input](/get-started/first-success#store-a-memory), then inspect `.neottia/memory/facts/`.

The server fixes its CWD at process or factory creation. It is non-interactive and converts stale `prompt` policy to `rebuild`. `server.close()` closes the Memory tool context and backend.

Successful object-root outputs include MCP structured content. Lists, search results, exports, and other non-object roots remain text-only. Errors are plain text. The current server does not pass MCP request cancellation into Memory operations.

Library embedders can call `createMemoryServer({cwd, interactive, name, version})`; MCP use should leave `interactive` false. A disabled shard, invalid configuration, suspected secret, stale cache under `fail`, or unsupported filesystem returns a tool error. Correct the cause, run `memory_validate` when appropriate, and retry. Never print diagnostics to stdout.
