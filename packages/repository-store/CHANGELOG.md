# @neottia/repository-store

## 0.2.0

### Minor Changes

- [#62](https://github.com/dragoscirjan/neottia/pull/62) [`784b110`](https://github.com/dragoscirjan/neottia/commit/784b110140a3158e9e730732c839e5475348d283) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Harden repository-local storage with a lazily loaded Linux Node-API `RENAME_NOREPLACE` backend, fail-closed exact publication, identity-bound lease cleanup, structured fsync failures, aggregate SQLite parameter and artifact limits, and exact disposable-cache removal. Complete filesystem Memory's migration to repository-store authority/cache primitives, add incremental bounded projection verification, and remove the deprecated unsafe shard-barrier and `SqliteIndex` exports.

### Patch Changes

- [#95](https://github.com/dragoscirjan/neottia/pull/95) [`7344aa0`](https://github.com/dragoscirjan/neottia/commit/7344aa03b290cffa96ceded5c6988118f46618f4) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Clamp issue search resources, validate idempotent links, canonicalize explicit no-op writes, align root validation, add structured cache verification, and preserve bounded cache/resolver diagnostics across MCP.

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`b35c677`](https://github.com/dragoscirjan/neottia/commit/b35c677aa8c197de41284c6c7e2ca661a5484ceb) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Bound root configuration file size and YAML structure before conversion, reject blocking special files before reading, validate every environment binding against its contribution schema, accept empty reserved root sections, reject credentials in Searchable service endpoints, and enforce portable Windows-safe managed paths in runtime and generated schemas. Design Docs root rules remain schema-visible while preserving portable Unicode directory names.
