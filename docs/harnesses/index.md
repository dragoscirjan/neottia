# Native harness extensions

Neottia ships native extensions for Pi and OpenCode. Each host has Memory, Issues, Design Docs, and Searchable packages. Native means the host loads the package in process.

- [Configure Pi](/harnesses/pi)
- [Configure OpenCode](/harnesses/opencode)
- [Use the declarative adapter contract](/harnesses/adapters)

`@neottia/harness-adapter` keeps host paths and configuration formats out of generated SDLC content and installation logic. Pi and OpenCode adapters publish exact feature support and return reviewable plans.

Other clients may use the [generic MCP servers](/mcp/) if they can launch a stdio MCP process. Searchable is available through `@neottia/searchable-mcp` and the native `@neottia/pi-searchable` and `@neottia/opencode-searchable` adapters.
