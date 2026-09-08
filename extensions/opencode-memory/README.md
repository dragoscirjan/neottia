# @neottia/opencode-memory

OpenCode plugin that registers Neottia's nine `memory_*` tools in-process:
store, supersede, delete, get, list, search, validate, export, and import.

## Installation

Install the package and add `@neottia/opencode-memory` to the OpenCode plugin configuration. The plugin reads the project `.neottia/config.yml` and `NEOTTIA_MEMORY_*` environment variables. Memory files remain canonical YAML under the configured memory root.

## Configuration

Use `backend: filesystem` for repository-local memory or `backend: postgres` for a shared PostgreSQL store. OpenCode's MCP configuration can alternatively load `@neottia/memory-mcp` when a separate server process is preferred.

For embedded use, pass `onStaleCache` on the context to enable confirmation and call `closeMemoryToolContext(context)` when the host unloads the plugin. See the [memory configuration guide](../../docs/memory/configuration.md) for the complete contract.

## License

MIT; see [LICENSE](./LICENSE).
