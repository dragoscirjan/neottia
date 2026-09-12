# Design Docs MCP server

`@neottia/design-docs-mcp` requires Node.js 22.16 or newer and the [filesystem platform requirements](/get-started/requirements). Launch it from the project directory:

```sh
pnpm dlx @neottia/design-docs-mcp
```

Enable `skills.design_docs`, call `tools/list`, and verify the 13 names in the [Design Docs tool reference](/design-docs/tools). Run the [first document call](/get-started/first-success#create-a-design-document) and inspect `.neottia/design-docs/`.

The server fixes its CWD at creation, uses non-interactive cache handling, forwards cancellation, and clears its tool context on `server.close()`. Successful objects and errors are returned as structured JSON content.

Use `createDesignDocsServer({cwd, name, version, linkValidator})` to embed it. The default validator comes from `@neottia/issues-design-docs`. Pass a custom validator only when your application owns issue-reference checks. See [composition](/issues/design-docs).

The server cannot ask a person to approve a transition. The caller supplies intent and evidence, and that evidence is an attestation rather than proof of a UI action. For stale revisions, fetch the current document before retrying. Use `document_validate` for stale cache or canonical-format diagnostics.
