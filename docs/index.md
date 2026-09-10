# Neottia

Neottia provides a shared software-development lifecycle for AI coding harnesses.

## Supported harnesses

- OpenCode
- Pi

Support for additional harnesses will be added as their integrations become available.

## Modules

Neottia ships independently versioned packages and extensions. A global Neottia release records the exact compatible version of every published module in `@neottia/release`.

| Module                      | Purpose                                                       | Documentation                         |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------- |
| `@neottia/design-docs`      | Versioned Markdown designs + SQLite BM25 search               | [Design Docs](/design-docs/)          |
| `@neottia/design-docs-mcp`  | Generic MCP server exposing all Design Docs tools             | [Design Docs](/design-docs/)          |
| `@neottia/memory-core`      | Durable agent memory: YAML records + SQLite BM25 search       | [Memory guide](/memory/)              |
| `@neottia/memory-mcp`       | MCP server exposing the memory tools to any harness           | [Tool contract](/memory/tools)        |
| `@neottia/repository-store` | Canonical files, leases, recovery, and SQLite cache lifecycle | [Repository store](/repository-store) |
