# @neottia/memory-core

## 0.2.0

### Minor Changes

- [#8](https://github.com/dragoscirjan/neottia/pull/8) [`22e990a`](https://github.com/dragoscirjan/neottia/commit/22e990ac8d2a9982d33d046fc0549c0f2f32d366) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Initial release: standalone agent memory with filesystem-canonical YAML records, SQLite FTS5 (BM25) index, shard-scoped locking, supersession/tombstone lifecycle, secret scanning, and the sharded `skills.memory` config contract with `NEOTTIA_MEMORY_*` env overrides.

- [#38](https://github.com/dragoscirjan/neottia/pull/38) [`6e49073`](https://github.com/dragoscirjan/neottia/commit/6e490731d781706dbf32f38d25b251f0642d5dd6) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Align memory tool constraints across core, Pi, OpenCode, and MCP surfaces; publish the generated configuration schema and document PostgreSQL-backed memory and interactive cache decisions.

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`3312760`](https://github.com/dragoscirjan/neottia/commit/33127604e15a387d40b6206e82ab3c6e16d62052) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Migrate Memory configuration loading to the shared resolver, export its typed contribution and patch schemas, preserve standalone compatibility aliases and environment bindings, and redact PostgreSQL credentials in shared snapshots.

- [#62](https://github.com/dragoscirjan/neottia/pull/62) [`784b110`](https://github.com/dragoscirjan/neottia/commit/784b110140a3158e9e730732c839e5475348d283) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Harden repository-local storage with a lazily loaded Linux Node-API `RENAME_NOREPLACE` backend, fail-closed exact publication, identity-bound lease cleanup, structured fsync failures, aggregate SQLite parameter and artifact limits, and exact disposable-cache removal. Complete filesystem Memory's migration to repository-store authority/cache primitives, add incremental bounded projection verification, and remove the deprecated unsafe shard-barrier and `SqliteIndex` exports.

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`5caeb74`](https://github.com/dragoscirjan/neottia/commit/5caeb745dfc8e10b748d00cb6d65aef9018c599b) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Resolve immutable shared snapshots once per host cwd, inject typed shards into tool contexts, and derive non-interactive stale-cache policy as a runtime override without rereading declared configuration.
  
  Add complete isolated Testkit configuration fixtures and preserve per-invocation Pi worktree routing and host cleanup.

### Patch Changes

- [#97](https://github.com/dragoscirjan/neottia/pull/97) [`73266c2`](https://github.com/dragoscirjan/neottia/commit/73266c265792c373bbf42841dd6efd21eb0f4c18) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Fix cache freshness and root-path validation, add shared PostgreSQL import lifecycle coverage, and correct filesystem isolation and cache guidance.
- Updated dependencies [[`1db6375`](https://github.com/dragoscirjan/neottia/commit/1db6375b82a6c46b6be5e0899c97b82888b2437c), [`b4abca1`](https://github.com/dragoscirjan/neottia/commit/b4abca120a43d18bfa34dab4069922e77f3a8362), [`b835244`](https://github.com/dragoscirjan/neottia/commit/b83524409e4c432069a98e5210a3397c46cd67db), [`04e5667`](https://github.com/dragoscirjan/neottia/commit/04e56679fdc4ea05b87af2f7d3e188bad76464e7), [`3e8bb31`](https://github.com/dragoscirjan/neottia/commit/3e8bb314eb9e00ceb23e81f3522766b33c111795), [`c4ecd36`](https://github.com/dragoscirjan/neottia/commit/c4ecd36cd0885fbfb0033cd49e0650115422b0e1), [`3312760`](https://github.com/dragoscirjan/neottia/commit/33127604e15a387d40b6206e82ab3c6e16d62052), [`784b110`](https://github.com/dragoscirjan/neottia/commit/784b110140a3158e9e730732c839e5475348d283), [`d1088a3`](https://github.com/dragoscirjan/neottia/commit/d1088a370c28ee28cd88c8b2f48c4a2bfb052c03), [`8cd0c3a`](https://github.com/dragoscirjan/neottia/commit/8cd0c3a89b9e418077d30db6fa82d9d70b4f2f15), [`7344aa0`](https://github.com/dragoscirjan/neottia/commit/7344aa03b290cffa96ceded5c6988118f46618f4), [`5caeb74`](https://github.com/dragoscirjan/neottia/commit/5caeb745dfc8e10b748d00cb6d65aef9018c599b), [`b35c677`](https://github.com/dragoscirjan/neottia/commit/b35c677aa8c197de41284c6c7e2ca661a5484ceb), [`842a04b`](https://github.com/dragoscirjan/neottia/commit/842a04be6d7938d34a711c9faf329fbf21f1eede)]:
  - @neottia/config@0.2.0
  - @neottia/repository-store@0.2.0
