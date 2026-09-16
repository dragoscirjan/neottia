# Module catalog

This catalog distinguishes how each package is delivered.

- `library/embedding` is a public TypeScript API or published metadata package.
- `native extension` loads in Pi or OpenCode in process.
- `generic MCP` is a shipped stdio server for an MCP-compatible client. It does not imply a native client integration.
- `internal/private` is not published for users.

| Module                          | Classification    | Canonical documentation                                                                |
| ------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `@neottia/core`                 | library/embedding | [Core](/reference/core)                                                                |
| `@neottia/config`               | library/embedding | [Unified configuration](/configuration)                                                |
| `@neottia/config-registry`      | library/embedding | [Official configuration registry](/configuration)                                      |
| `@neottia/distribution`         | library/embedding | [Asset distribution](/distribution/)                                                   |
| `@neottia/cli`                  | library/embedding | [Neottia CLI](/distribution/)                                                          |
| `@neottia/harness-adapter`      | library/embedding | [Harness adapter contract](/harnesses/adapters)                                        |
| `@neottia/design-docs`          | library/embedding | [Design Docs library](/design-docs/library)                                            |
| `@neottia/design-docs-mcp`      | generic MCP       | [Design Docs MCP](/mcp/design-docs)                                                    |
| `@neottia/issues`               | library/embedding | [Issues library](/issues/library)                                                      |
| `@neottia/issues-design-docs`   | library/embedding | [Issues and Design Docs](/issues/design-docs)                                          |
| `@neottia/issues-mcp`           | generic MCP       | [Issues MCP](/mcp/issues)                                                              |
| `@neottia/memory-core`          | library/embedding | [Memory library](/memory/library)                                                      |
| `@neottia/memory-mcp`           | generic MCP       | [Memory MCP](/mcp/memory)                                                              |
| `@neottia/release`              | library/embedding | [Release metadata](/reference/release)                                                 |
| `@neottia/repository-store`     | library/embedding | [Repository Store](/repository-store)                                                  |
| `@neottia/searchable-core`      | library/embedding | [Searchable](/searchable/)                                                             |
| `@neottia/searchable-mcp`       | generic MCP       | [Searchable MCP](/mcp/searchable)                                                      |
| `@neottia/sdlc`                 | library/embedding | [SDLC provider selection](/configuration#sdlc-provider-selection)                      |
| `@neottia/testkit`              | internal/private  | Private repository test helpers; packages/testkit/README.md is the internal reference. |
| `@neottia/pi-adapter`           | library/embedding | [Harness adapter contract](/harnesses/adapters)                                        |
| `@neottia/pi-memory`            | native extension  | [Pi Memory](/harnesses/pi#memory)                                                      |
| `@neottia/pi-issues`            | native extension  | [Pi Issues](/harnesses/pi#issues)                                                      |
| `@neottia/pi-design-docs`       | native extension  | [Pi Design Docs](/harnesses/pi#design-docs)                                            |
| `@neottia/pi-searchable`        | native extension  | [Pi Searchable](/harnesses/pi#searchable)                                              |
| `@neottia/opencode-adapter`     | library/embedding | [Harness adapter contract](/harnesses/adapters)                                        |
| `@neottia/opencode-memory`      | native extension  | [OpenCode Memory](/harnesses/opencode#memory)                                          |
| `@neottia/opencode-issues`      | native extension  | [OpenCode Issues](/harnesses/opencode#issues)                                          |
| `@neottia/opencode-design-docs` | native extension  | [OpenCode Design Docs](/harnesses/opencode#design-docs)                                |
| `@neottia/opencode-searchable`  | native extension  | [OpenCode Searchable](/harnesses/opencode#searchable)                                  |

`docs/module-catalog.json` is the machine-readable copy checked against workspace manifests and this table.
