# @neottia/issues-mcp

Generic stdio MCP server for all 17 Issues tools. It requires Node.js 22.16 or newer and the supported filesystem platform.

```sh
pnpm dlx @neottia/issues-mcp
```

Run it from the project CWD after enabling `skills.issues`. Use MCP `tools/list` to verify 17 tools, then call `issue_create`. The server is non-interactive, forwards cancellation, exposes tools but no resources or prompts, and clears context on `server.close()`. Successful objects use structured content; errors are structured JSON in text. `createIssueServer({resolver})` replaces the default Design Docs resolver.

Read the [Issues MCP guide](https://github.com/dragoscirjan/neottia/blob/main/docs/mcp/issues.md).
