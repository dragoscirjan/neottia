# @neottia/repository-store

## 0.3.3

### Patch Changes

- [#240](https://github.com/dragoscirjan/neottia/pull/240) [`3cc3b71`](https://github.com/dragoscirjan/neottia/commit/3cc3b710e066696910b4e4b7aa7a0145c272eceb) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Publish a new signed native prebuild set after release workflow recovery.

## 0.3.2

### Patch Changes

- [#232](https://github.com/dragoscirjan/neottia/pull/232) [`24b2975`](https://github.com/dragoscirjan/neottia/commit/24b2975a305a137e4a6841af0caf6cc97febb4c8) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Treat preliminary zero-link authority claim and file-lease observations as retryable release contention.

- [#226](https://github.com/dragoscirjan/neottia/pull/226) [`c1ddbac`](https://github.com/dragoscirjan/neottia/commit/c1ddbac158a2ce1fdd6d41a48e183f5be7787a62) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Treat zero-link interrupted authority claim observations as retryable release contention.

- [#224](https://github.com/dragoscirjan/neottia/pull/224) [`93060b0`](https://github.com/dragoscirjan/neottia/commit/93060b0d3692ff4501cd67ba299b3c61dba81eec) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Retry bounded transient NTFS sharing failures while releasing an owned repository authority lease.

## 0.3.1

### Patch Changes

- [#219](https://github.com/dragoscirjan/neottia/pull/219) [`ec60fec`](https://github.com/dragoscirjan/neottia/commit/ec60fec1f046edddf1552a4c65d07bdbca3f9b57) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Treat a lease file unlinked during verified owner reads as normal identity contention while preserving fail-closed hard-link checks.

- [#216](https://github.com/dragoscirjan/neottia/pull/216) [`57ea813`](https://github.com/dragoscirjan/neottia/commit/57ea813b78491b05bd88ae96e50384fa4064fab1) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Download version-pinned native prebuilds from GitHub Releases, verify their Sigstore signature and SHA-256 digest before installation, detect post-install binary changes before loading, and retain an explicit source-build fallback.

## 0.3.0

### Minor Changes

- [#214](https://github.com/dragoscirjan/neottia/pull/214) [`b90998c`](https://github.com/dragoscirjan/neottia/commit/b90998cf93f8aee64e28ef5025c470fcc6402796) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add fail-closed FreeBSD 14.x x64 support for Node.js on local UFS2 filesystems.

## 0.2.1

### Patch Changes

- [#206](https://github.com/dragoscirjan/neottia/pull/206) [`3dc447d`](https://github.com/dragoscirjan/neottia/commit/3dc447d3a3134fe5cc3f1185e6099ecc8275693d) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add native Repository Store support for macOS 15 and 26 on x64 and arm64 local APFS volumes.

- [#209](https://github.com/dragoscirjan/neottia/pull/209) [`bc9f2fc`](https://github.com/dragoscirjan/neottia/commit/bc9f2fcd20854588e4a940b74e301db36e31a6a9) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add the native Windows x64 backend for atomic no-replace publication and durable file synchronization on local NTFS volumes.

## 0.2.0

### Minor Changes

- [#62](https://github.com/dragoscirjan/neottia/pull/62) [`784b110`](https://github.com/dragoscirjan/neottia/commit/784b110140a3158e9e730732c839e5475348d283) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Harden repository-local storage with a lazily loaded Linux Node-API `RENAME_NOREPLACE` backend, fail-closed exact publication, identity-bound lease cleanup, structured fsync failures, aggregate SQLite parameter and artifact limits, and exact disposable-cache removal. Complete filesystem Memory's migration to repository-store authority/cache primitives, add incremental bounded projection verification, and remove the deprecated unsafe shard-barrier and `SqliteIndex` exports.

### Patch Changes

- [#95](https://github.com/dragoscirjan/neottia/pull/95) [`7344aa0`](https://github.com/dragoscirjan/neottia/commit/7344aa03b290cffa96ceded5c6988118f46618f4) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Clamp issue search resources, validate idempotent links, canonicalize explicit no-op writes, align root validation, add structured cache verification, and preserve bounded cache/resolver diagnostics across MCP.

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`b35c677`](https://github.com/dragoscirjan/neottia/commit/b35c677aa8c197de41284c6c7e2ca661a5484ceb) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Bound root configuration file size and YAML structure before conversion, reject blocking special files before reading, validate every environment binding against its contribution schema, accept empty reserved root sections, reject credentials in Searchable service endpoints, and enforce portable Windows-safe managed paths in runtime and generated schemas. Design Docs root rules remain schema-visible while preserving portable Unicode directory names.
