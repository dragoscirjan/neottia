# @neottia/issues-mcp

Generic stdio MCP exposure of all `@neottia/issues` tools, using the core package's generated input and output schemas.

```bash
pnpm exec issues-mcp
```

The server uses its process working directory as the project, never prompts, maps only `prompt` cache policy to rebuild (explicit `fail` remains authoritative), forwards cancellation, and emits structured JSON results and errors. Library composition can call `createIssueServer({resolver})` to enable typed design-document links.
