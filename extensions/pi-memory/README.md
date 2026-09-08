# @neottia/pi-memory

Pi extension that registers Neottia's nine `memory_*` tools in-process:
store, supersede, delete, get, list, search, validate, export, and import.

## Installation

Install the package in a Pi project and load `@neottia/pi-memory` as an extension. The extension reads the project's `.neottia/config.yml` and `NEOTTIA_MEMORY_*` environment variables. Memory files remain canonical YAML under the configured memory root.

## Configuration

Use `backend: filesystem` for repository-local memory or `backend: postgres` for a shared PostgreSQL store. Pass `onStaleCache` when embedding the registration helper to confirm `cache.stale_policy: prompt` decisions; declining leaves the cache unchanged.

See the [memory configuration guide](../../docs/memory/configuration.md) for the complete contract.

## License

MIT; see [LICENSE](./LICENSE).
