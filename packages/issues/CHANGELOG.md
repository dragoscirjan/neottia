# @neottia/issues

## 0.2.0

### Minor Changes

- [#63](https://github.com/dragoscirjan/neottia/pull/63) [`639505e`](https://github.com/dragoscirjan/neottia/commit/639505e80b9cc2b0c538a9d4e291704cc8c98d7b) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add filesystem-canonical issue management, ranked disposable search, one shared tool registry, generic MCP, and thin Pi/OpenCode adapters.

- [#64](https://github.com/dragoscirjan/neottia/pull/64) [`fc18529`](https://github.com/dragoscirjan/neottia/commit/fc1852941e092e4cbd51912bfae1bdd6a9264225) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add filesystem-canonical versioned Design Docs, strict fence-aware headings, bounded shared results and errors, Pi stale-cache confirmation, and real cycle-free Issues link validation across MCP, Pi, and OpenCode.

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`5caeb74`](https://github.com/dragoscirjan/neottia/commit/5caeb745dfc8e10b748d00cb6d65aef9018c599b) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Resolve immutable shared snapshots once per host cwd, inject typed shards into tool contexts, and derive non-interactive stale-cache policy as a runtime override without rereading declared configuration.
  
  Add complete isolated Testkit configuration fixtures and preserve per-invocation Pi worktree routing and host cleanup.

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`18a0b73`](https://github.com/dragoscirjan/neottia/commit/18a0b7301b45d7744efc8e609336e2a54db7665e) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Migrate Issues configuration loading to the shared resolver, export its typed contribution and default-free patch schemas, and preserve standalone aliases, environment bindings, limits, and explicit IssueStore configuration.

### Patch Changes

- [#62](https://github.com/dragoscirjan/neottia/pull/62) [`784b110`](https://github.com/dragoscirjan/neottia/commit/784b110140a3158e9e730732c839e5475348d283) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Harden repository-local storage with a lazily loaded Linux Node-API `RENAME_NOREPLACE` backend, fail-closed exact publication, identity-bound lease cleanup, structured fsync failures, aggregate SQLite parameter and artifact limits, and exact disposable-cache removal. Complete filesystem Memory's migration to repository-store authority/cache primitives, add incremental bounded projection verification, and remove the deprecated unsafe shard-barrier and `SqliteIndex` exports.

- [#95](https://github.com/dragoscirjan/neottia/pull/95) [`7344aa0`](https://github.com/dragoscirjan/neottia/commit/7344aa03b290cffa96ceded5c6988118f46618f4) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Clamp issue search resources, validate idempotent links, canonicalize explicit no-op writes, align root validation, add structured cache verification, and preserve bounded cache/resolver diagnostics across MCP.

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`b35c677`](https://github.com/dragoscirjan/neottia/commit/b35c677aa8c197de41284c6c7e2ca661a5484ceb) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Bound root configuration file size and YAML structure before conversion, reject blocking special files before reading, validate every environment binding against its contribution schema, accept empty reserved root sections, reject credentials in Searchable service endpoints, and enforce portable Windows-safe managed paths in runtime and generated schemas. Design Docs root rules remain schema-visible while preserving portable Unicode directory names.
- Updated dependencies [[`1db6375`](https://github.com/dragoscirjan/neottia/commit/1db6375b82a6c46b6be5e0899c97b82888b2437c), [`b4abca1`](https://github.com/dragoscirjan/neottia/commit/b4abca120a43d18bfa34dab4069922e77f3a8362), [`b835244`](https://github.com/dragoscirjan/neottia/commit/b83524409e4c432069a98e5210a3397c46cd67db), [`04e5667`](https://github.com/dragoscirjan/neottia/commit/04e56679fdc4ea05b87af2f7d3e188bad76464e7), [`3e8bb31`](https://github.com/dragoscirjan/neottia/commit/3e8bb314eb9e00ceb23e81f3522766b33c111795), [`c4ecd36`](https://github.com/dragoscirjan/neottia/commit/c4ecd36cd0885fbfb0033cd49e0650115422b0e1), [`3312760`](https://github.com/dragoscirjan/neottia/commit/33127604e15a387d40b6206e82ab3c6e16d62052), [`784b110`](https://github.com/dragoscirjan/neottia/commit/784b110140a3158e9e730732c839e5475348d283), [`d1088a3`](https://github.com/dragoscirjan/neottia/commit/d1088a370c28ee28cd88c8b2f48c4a2bfb052c03), [`8cd0c3a`](https://github.com/dragoscirjan/neottia/commit/8cd0c3a89b9e418077d30db6fa82d9d70b4f2f15), [`7344aa0`](https://github.com/dragoscirjan/neottia/commit/7344aa03b290cffa96ceded5c6988118f46618f4), [`5caeb74`](https://github.com/dragoscirjan/neottia/commit/5caeb745dfc8e10b748d00cb6d65aef9018c599b), [`b35c677`](https://github.com/dragoscirjan/neottia/commit/b35c677aa8c197de41284c6c7e2ca661a5484ceb), [`842a04b`](https://github.com/dragoscirjan/neottia/commit/842a04be6d7938d34a711c9faf329fbf21f1eede)]:
  - @neottia/config@0.2.0
  - @neottia/repository-store@0.2.0
