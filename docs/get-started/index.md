# Choose a delivery method

Neottia ships three ways to use Memory, Issues, Design Docs, and Searchable.

| Need                                   | Choose                                             | Packages                                                                                            |
| -------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Tools inside Pi or OpenCode            | [Native extensions](/harnesses/)                   | `@neottia/pi-*` or `@neottia/opencode-*`                                                            |
| Claude Code lifecycle and tools        | [Claude Code distribution](/harnesses/claude-code) | Exact generic MCP packages in project `.mcp.json`                                                   |
| Tools in another MCP-compatible client | [Generic MCP](/mcp/)                               | `@neottia/memory-mcp`, `@neottia/issues-mcp`, `@neottia/design-docs-mcp`, `@neottia/searchable-mcp` |
| An API inside your TypeScript process  | Direct library                                     | `@neottia/memory-core`, `@neottia/issues`, `@neottia/design-docs`, `@neottia/searchable-core`       |

Native support means Neottia supplies an in-process extension for that host. Claude Code support uses Neottia's compiler, installer, receipts, doctor, and project MCP configuration. Generic MCP compatibility alone means only that a client can launch a shipped stdio server. These terms are not interchangeable.

Continue with [requirements](/get-started/requirements), [configuration](/get-started/configuration), and [first success](/get-started/first-success).
