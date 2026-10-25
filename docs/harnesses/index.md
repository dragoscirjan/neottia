# Supported harnesses

Neottia supports Pi, OpenCode, and Claude Code. Pi and OpenCode load native Memory, Issues, Design Docs, and Searchable extensions in process. Claude Code launches the matching generic MCP servers from project `.mcp.json` entries.

- [Configure Pi](/harnesses/pi)
- [Configure OpenCode](/harnesses/opencode)
- [Configure Claude Code](/harnesses/claude-code)
- [Use the declarative adapter contract](/harnesses/adapters)

`@neottia/harness-adapter` keeps host paths and configuration formats out of generated SDLC content and installation logic. The Pi, OpenCode, and Claude Code adapters publish exact feature support and return reviewable plans.

Other clients may use the [generic MCP servers](/mcp/) if they can launch a stdio MCP process. Neottia does not provide supported lifecycle distribution for those clients.
