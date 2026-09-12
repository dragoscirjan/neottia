# Choose a delivery method

Neottia ships three ways to use Memory, Issues, and Design Docs.

| Need                                   | Choose                           | Packages                                                                 |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Tools inside Pi or OpenCode            | [Native extensions](/harnesses/) | `@neottia/pi-*` or `@neottia/opencode-*`                                 |
| Tools in another MCP-compatible client | [Generic MCP](/mcp/)             | `@neottia/memory-mcp`, `@neottia/issues-mcp`, `@neottia/design-docs-mcp` |
| An API inside your TypeScript process  | Direct library                   | `@neottia/memory-core`, `@neottia/issues`, `@neottia/design-docs`        |

Native support means Neottia supplies an in-process extension for that host. Generic MCP compatibility means the client can launch a shipped stdio server. These terms are not interchangeable.

Searchable is [foundation-only](/searchable/). It has no MCP server or native extension. Use it only in an application that provides all five services.

Continue with [requirements](/get-started/requirements), [configuration](/get-started/configuration), and [first success](/get-started/first-success).
