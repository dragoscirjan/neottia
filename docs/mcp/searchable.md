# Searchable MCP server

`@neottia/searchable-mcp` exposes all five Searchable tools over stdio.

```sh
pnpm dlx @neottia/searchable-mcp
```

Start it in the project directory containing `.neottia/config.yml` and enable `modules.searchable`. The server resolves the official shared configuration snapshot once at startup. A generic client entry is:

```json
{
  "mcpServers": {
    "neottia-searchable": {
      "command": "pnpm",
      "args": ["dlx", "@neottia/searchable-mcp"]
    }
  }
}
```

The server advertises tools only. It sends validated results as MCP structured content and JSON text. Failures set `isError` and include a redacted structured error in text. It forwards MCP cancellation into the runtime and closes its runtime when the server closes.

`cache.stale_policy: prompt` rebuilds non-interactively because stdio MCP has no confirmation UI. Use `fail` if an operator must authorize rebuilds outside the server.

Do not configure both this MCP server and a native Searchable extension in the same harness. Duplicate registrations make tool routing ambiguous.
