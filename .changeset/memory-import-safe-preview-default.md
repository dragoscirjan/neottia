---
"@neottia/memory-core": minor
"@neottia/memory-mcp": minor
"@neottia/pi-memory": minor
"@neottia/opencode-memory": minor
---

Make omitted `preview` the safe default for `memory_import`: it now validates without writing (previously it committed), matching the Issues and Design Docs import behavior. Publishing records and tombstones requires explicit `preview: false`, with identical diagnostics between preview and mutation, and updated docs plus Pi, OpenCode, and MCP contract tests for the new default.
