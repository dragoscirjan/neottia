# Module catalog

This catalog distinguishes how each package is delivered.

- `library/embedding` is a public TypeScript API or published metadata package.
- `native extension` loads in Pi or OpenCode in process.
- `generic MCP` is a shipped stdio server for an MCP-compatible client. It does not imply a native client integration.
- `foundation-only` provides contracts and validation but requires caller-owned implementations.
- `internal/private` is not published for users.

| Module                          | Classification    | Canonical documentation                                                                |
| ------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `@neottia/core`                 | library/embedding | [Core](/reference/core)                                                                |
| `@neottia/design-docs`          | library/embedding | [Design Docs library](/design-docs/library)                                            |
| `@neottia/design-docs-mcp`      | generic MCP       | [Design Docs MCP](/mcp/design-docs)                                                    |
| `@neottia/issues`               | library/embedding | [Issues library](/issues/library)                                                      |
| `@neottia/issues-design-docs`   | library/embedding | [Issues and Design Docs](/issues/design-docs)                                          |
| `@neottia/issues-mcp`           | generic MCP       | [Issues MCP](/mcp/issues)                                                              |
| `@neottia/memory-core`          | library/embedding | [Memory library](/memory/library)                                                      |
| `@neottia/memory-mcp`           | generic MCP       | [Memory MCP](/mcp/memory)                                                              |
| `@neottia/release`              | library/embedding | [Release metadata](/reference/release)                                                 |
| `@neottia/repository-store`     | library/embedding | [Repository Store](/repository-store)                                                  |
| `@neottia/searchable-core`      | foundation-only   | [Searchable](/searchable/)                                                             |
| `@neottia/testkit`              | internal/private  | Private repository test helpers; packages/testkit/README.md is the internal reference. |
| `@neottia/pi-memory`            | native extension  | [Pi Memory](/harnesses/pi#memory)                                                      |
| `@neottia/pi-issues`            | native extension  | [Pi Issues](/harnesses/pi#issues)                                                      |
| `@neottia/pi-design-docs`       | native extension  | [Pi Design Docs](/harnesses/pi#design-docs)                                            |
| `@neottia/opencode-memory`      | native extension  | [OpenCode Memory](/harnesses/opencode#memory)                                          |
| `@neottia/opencode-issues`      | native extension  | [OpenCode Issues](/harnesses/opencode#issues)                                          |
| `@neottia/opencode-design-docs` | native extension  | [OpenCode Design Docs](/harnesses/opencode#design-docs)                                |

`docs/module-catalog.json` is the machine-readable copy checked against workspace manifests and this table.
