# @neottia/memory-mcp

## 0.2.0

### Minor Changes

- [#9](https://github.com/dragoscirjan/neottia/pull/9) [`92f9537`](https://github.com/dragoscirjan/neottia/commit/92f95377a12cfc7ad3494f1a871414929e249fe2) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Initial release: MCP stdio server exposing the nine `memory_*` tools with the identical contract as the in-process extensions; generated JSON Schema from the same Zod models; non-interactive stale-cache handling.

### Patch Changes

- [#97](https://github.com/dragoscirjan/neottia/pull/97) [`73266c2`](https://github.com/dragoscirjan/neottia/commit/73266c265792c373bbf42841dd6efd21eb0f4c18) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Fix cache freshness and root-path validation, add shared PostgreSQL import lifecycle coverage, and correct filesystem isolation and cache guidance.

- [#38](https://github.com/dragoscirjan/neottia/pull/38) [`6e49073`](https://github.com/dragoscirjan/neottia/commit/6e490731d781706dbf32f38d25b251f0642d5dd6) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Align memory tool constraints across core, Pi, OpenCode, and MCP surfaces; publish the generated configuration schema and document PostgreSQL-backed memory and interactive cache decisions.

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`5caeb74`](https://github.com/dragoscirjan/neottia/commit/5caeb745dfc8e10b748d00cb6d65aef9018c599b) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Resolve immutable shared snapshots once per host cwd, inject typed shards into tool contexts, and derive non-interactive stale-cache policy as a runtime override without rereading declared configuration.
  
  Add complete isolated Testkit configuration fixtures and preserve per-invocation Pi worktree routing and host cleanup.
- Updated dependencies [[`1db6375`](https://github.com/dragoscirjan/neottia/commit/1db6375b82a6c46b6be5e0899c97b82888b2437c), [`b4abca1`](https://github.com/dragoscirjan/neottia/commit/b4abca120a43d18bfa34dab4069922e77f3a8362), [`b835244`](https://github.com/dragoscirjan/neottia/commit/b83524409e4c432069a98e5210a3397c46cd67db), [`04e5667`](https://github.com/dragoscirjan/neottia/commit/04e56679fdc4ea05b87af2f7d3e188bad76464e7), [`3e8bb31`](https://github.com/dragoscirjan/neottia/commit/3e8bb314eb9e00ceb23e81f3522766b33c111795), [`22e990a`](https://github.com/dragoscirjan/neottia/commit/22e990ac8d2a9982d33d046fc0549c0f2f32d366), [`73266c2`](https://github.com/dragoscirjan/neottia/commit/73266c265792c373bbf42841dd6efd21eb0f4c18), [`6e49073`](https://github.com/dragoscirjan/neottia/commit/6e490731d781706dbf32f38d25b251f0642d5dd6), [`8e827a6`](https://github.com/dragoscirjan/neottia/commit/8e827a6a717ccb4d910d4ca86f592c86b59ecb07), [`c4ecd36`](https://github.com/dragoscirjan/neottia/commit/c4ecd36cd0885fbfb0033cd49e0650115422b0e1), [`3312760`](https://github.com/dragoscirjan/neottia/commit/33127604e15a387d40b6206e82ab3c6e16d62052), [`784b110`](https://github.com/dragoscirjan/neottia/commit/784b110140a3158e9e730732c839e5475348d283), [`d1088a3`](https://github.com/dragoscirjan/neottia/commit/d1088a370c28ee28cd88c8b2f48c4a2bfb052c03), [`8cd0c3a`](https://github.com/dragoscirjan/neottia/commit/8cd0c3a89b9e418077d30db6fa82d9d70b4f2f15), [`5caeb74`](https://github.com/dragoscirjan/neottia/commit/5caeb745dfc8e10b748d00cb6d65aef9018c599b), [`b35c677`](https://github.com/dragoscirjan/neottia/commit/b35c677aa8c197de41284c6c7e2ca661a5484ceb), [`842a04b`](https://github.com/dragoscirjan/neottia/commit/842a04be6d7938d34a711c9faf329fbf21f1eede)]:
  - @neottia/config@0.2.0
  - @neottia/config-registry@0.2.0
  - @neottia/memory-core@0.2.0
