# @neottia/design-docs-mcp

Generic stdio MCP server for all 13 Design Docs tools. It requires Node.js 22.16 or newer and the supported filesystem platform.

```sh
pnpm dlx @neottia/design-docs-mcp
```

Run it from the project CWD after enabling `skills.design_docs`. Use MCP `tools/list` to verify 13 tools, then call `document_create`. The server is non-interactive, forwards cancellation, exposes tools but no resources or prompts, and clears context on `server.close()`. Results and errors use structured JSON content. `createDesignDocsServer({linkValidator})` replaces the default Issues validator.

Read the [Design Docs MCP guide](https://github.com/dragoscirjan/neottia/blob/main/docs/mcp/design-docs.md).
