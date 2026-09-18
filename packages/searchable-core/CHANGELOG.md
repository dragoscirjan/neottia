# @neottia/searchable-core

## 0.2.0

### Minor Changes

- [#94](https://github.com/dragoscirjan/neottia/pull/94) [`b461238`](https://github.com/dragoscirjan/neottia/commit/b461238c9578b3d0a5974b3a44b8c73ee42cee3a) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add the Searchable configuration, validated tool contracts, injectable service interfaces, redacted errors, and shared executable registry.

- [`a348a3d`](https://github.com/dragoscirjan/neottia/commit/a348a3d10e32e8c3d1dc5936d934b953ae41d395) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add the concrete Searchable runtime, providers, safe extraction, canonical stash and FTS search, Ollama answers, legacy migration, MCP server, and native Pi/OpenCode extensions.

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`8cd0c3a`](https://github.com/dragoscirjan/neottia/commit/8cd0c3a89b9e418077d30db6fa82d9d70b4f2f15) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add trusted environment-binding parsers for schema-validated legacy value transforms without exposing raw values or parser failures.
  
  Migrate Searchable configuration to the shared resolver, export its typed contribution and default-free patch schemas, and preserve provider, fetch, grep, ask, Ollama, cache, security, credential, environment-alias, standalone loader, service, and tool behavior.

### Patch Changes

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`b35c677`](https://github.com/dragoscirjan/neottia/commit/b35c677aa8c197de41284c6c7e2ca661a5484ceb) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Bound root configuration file size and YAML structure before conversion, reject blocking special files before reading, validate every environment binding against its contribution schema, accept empty reserved root sections, reject credentials in Searchable service endpoints, and enforce portable Windows-safe managed paths in runtime and generated schemas. Design Docs root rules remain schema-visible while preserving portable Unicode directory names.
- Updated dependencies [[`1db6375`](https://github.com/dragoscirjan/neottia/commit/1db6375b82a6c46b6be5e0899c97b82888b2437c), [`b4abca1`](https://github.com/dragoscirjan/neottia/commit/b4abca120a43d18bfa34dab4069922e77f3a8362), [`b835244`](https://github.com/dragoscirjan/neottia/commit/b83524409e4c432069a98e5210a3397c46cd67db), [`04e5667`](https://github.com/dragoscirjan/neottia/commit/04e56679fdc4ea05b87af2f7d3e188bad76464e7), [`3e8bb31`](https://github.com/dragoscirjan/neottia/commit/3e8bb314eb9e00ceb23e81f3522766b33c111795), [`c4ecd36`](https://github.com/dragoscirjan/neottia/commit/c4ecd36cd0885fbfb0033cd49e0650115422b0e1), [`3312760`](https://github.com/dragoscirjan/neottia/commit/33127604e15a387d40b6206e82ab3c6e16d62052), [`784b110`](https://github.com/dragoscirjan/neottia/commit/784b110140a3158e9e730732c839e5475348d283), [`d1088a3`](https://github.com/dragoscirjan/neottia/commit/d1088a370c28ee28cd88c8b2f48c4a2bfb052c03), [`8cd0c3a`](https://github.com/dragoscirjan/neottia/commit/8cd0c3a89b9e418077d30db6fa82d9d70b4f2f15), [`7344aa0`](https://github.com/dragoscirjan/neottia/commit/7344aa03b290cffa96ceded5c6988118f46618f4), [`5caeb74`](https://github.com/dragoscirjan/neottia/commit/5caeb745dfc8e10b748d00cb6d65aef9018c599b), [`b35c677`](https://github.com/dragoscirjan/neottia/commit/b35c677aa8c197de41284c6c7e2ca661a5484ceb), [`842a04b`](https://github.com/dragoscirjan/neottia/commit/842a04be6d7938d34a711c9faf329fbf21f1eede)]:
  - @neottia/config@0.2.0
  - @neottia/repository-store@0.2.0
