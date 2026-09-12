# @neottia/design-docs-mcp

Generic non-interactive MCP stdio server exposing the exact `@neottia/design-docs` tool registry. Configure `skills.design_docs.enabled: true`, then run `design-docs-mcp` from the project root. A `prompt` cache policy resolves to `rebuild`; lifecycle approval still requires explicit caller intent/evidence and never implies human confirmation.

The server installs the real `@neottia/issues-design-docs` validator by default. Enable `skills.issues` to use `document_validate` with `cross_domain: true`. Embedders can provide `createDesignDocsServer({linkValidator})` to replace the default composition.
