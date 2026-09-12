# @neottia/opencode-design-docs

OpenCode plugin exposing the shared `@neottia/design-docs` tools in process. Calls use the active plugin directory and do not pass through MCP. Each directory receives a real `@neottia/issues-design-docs` validator by default, so enabling both capabilities allows `document_validate(cross_domain: true)` to inspect stable issue links.

Use `createDesignDocsPlugin({linkValidator})` to inject a custom validator. OpenCode is non-interactive; a `prompt` stale-cache policy rebuilds automatically.
