# @neottia/design-docs-mcp

Generic stdio MCP server for all 13 Design Docs tools. It requires Node.js 22.16 or newer and a supported filesystem platform.

```sh
pnpm dlx @neottia/design-docs-mcp
```

Run it from the project CWD after enabling `modules.design_docs`. The deprecated `skills.design_docs` path remains available during migration. Use MCP `tools/list` to verify 13 tools, then call `document_create`.

The server is non-interactive, forwards cancellation, exposes tools but no resources or prompts, and clears its context on `server.close()`. Results and errors use structured JSON content. A `prompt` cache policy resolves to `rebuild`; lifecycle approval still requires explicit caller intent and evidence and never implies human confirmation.

The server installs the real `@neottia/issues-design-docs` validator by default. Enable `modules.issues` to use `document_validate` with `cross_domain: true`. Embedders can pass `createDesignDocsServer({linkValidator})` to replace the default validator.

Read the [Design Docs MCP guide](https://github.com/dragoscirjan/neottia/blob/main/docs/mcp/design-docs.md) and [unified configuration guide](../../docs/configuration.md).
