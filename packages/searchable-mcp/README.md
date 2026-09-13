# @neottia/searchable-mcp

Generic stdio MCP server for the five Searchable tools.

```sh
pnpm dlx @neottia/searchable-mcp
```

Run the command from the project working directory after setting `skills.searchable.enabled: true`. The server exposes tools only. Use MCP `tools/list` to verify `web_search`, `web_fetch`, `web_stash`, `web_grep`, and `web_ask`.

The server forwards request cancellation, returns object results as structured content and JSON text, and returns redacted structured errors as text. It owns one Searchable runtime and closes network and cache resources with `server.close()` or process termination.

Read the [Searchable MCP guide](https://github.com/dragoscirjan/neottia/blob/main/docs/mcp/searchable.md).
