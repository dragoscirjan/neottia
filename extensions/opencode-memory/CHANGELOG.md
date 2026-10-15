# @neottia/opencode-memory

## 0.2.1

### Patch Changes

- Updated dependencies [[`8873b4f`](https://github.com/dragoscirjan/neottia/commit/8873b4f696b6a3fe1d03d7b24eb611511fdd4cbc)]:
  - @neottia/config-registry@0.3.0

## 0.2.0

### Minor Changes

- [#176](https://github.com/dragoscirjan/neottia/pull/176) [`545c986`](https://github.com/dragoscirjan/neottia/commit/545c98617fbca8eec316564f66a67893e1d26fed) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Propagate host cancellation through Memory: the pi tool call signal, the OpenCode invocation abort, and the MCP request signal now flow into every `memory_*` tool, and `MemoryStore`/backend operations accept a `MemoryOperationControl` (`{ signal, deadline }`). Already-aborted calls reject with the stable `MemoryCancellationError` (`ABORTED` / `DEADLINE_EXCEEDED`) before any backend, lease, or cache work; cancellation is checked at safe phase boundaries while the atomic publication batch and post-commit cache maintenance remain non-interruptible. Adds Pi, OpenCode, and MCP cancellation contract tests plus representative filesystem/PostgreSQL coverage.

- [#175](https://github.com/dragoscirjan/neottia/pull/175) [`bbd40be`](https://github.com/dragoscirjan/neottia/commit/bbd40be53f4f7af19388856e5516c06909b63bba) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Make omitted `preview` the safe default for `memory_import`: it now validates without writing (previously it committed), matching the Issues and Design Docs import behavior. Publishing records and tombstones requires explicit `preview: false`, with identical diagnostics between preview and mutation, and updated docs plus Pi, OpenCode, and MCP contract tests for the new default.

### Patch Changes

- Updated dependencies [[`545c986`](https://github.com/dragoscirjan/neottia/commit/545c98617fbca8eec316564f66a67893e1d26fed), [`bbd40be`](https://github.com/dragoscirjan/neottia/commit/bbd40be53f4f7af19388856e5516c06909b63bba)]:
  - @neottia/memory-core@0.3.0
  - @neottia/config-registry@0.2.2

## 0.1.1

### Patch Changes

- [#38](https://github.com/dragoscirjan/neottia/pull/38) [`6e49073`](https://github.com/dragoscirjan/neottia/commit/6e490731d781706dbf32f38d25b251f0642d5dd6) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Align memory tool constraints across core, Pi, OpenCode, and MCP surfaces; publish the generated configuration schema and document PostgreSQL-backed memory and interactive cache decisions.

- [#133](https://github.com/dragoscirjan/neottia/pull/133) [`5caeb74`](https://github.com/dragoscirjan/neottia/commit/5caeb745dfc8e10b748d00cb6d65aef9018c599b) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Resolve immutable shared snapshots once per host cwd, inject typed shards into tool contexts, and derive non-interactive stale-cache policy as a runtime override without rereading declared configuration.
  
  Add complete isolated Testkit configuration fixtures and preserve per-invocation Pi worktree routing and host cleanup.
- Updated dependencies [[`b835244`](https://github.com/dragoscirjan/neottia/commit/b83524409e4c432069a98e5210a3397c46cd67db), [`3e8bb31`](https://github.com/dragoscirjan/neottia/commit/3e8bb314eb9e00ceb23e81f3522766b33c111795), [`22e990a`](https://github.com/dragoscirjan/neottia/commit/22e990ac8d2a9982d33d046fc0549c0f2f32d366), [`73266c2`](https://github.com/dragoscirjan/neottia/commit/73266c265792c373bbf42841dd6efd21eb0f4c18), [`6e49073`](https://github.com/dragoscirjan/neottia/commit/6e490731d781706dbf32f38d25b251f0642d5dd6), [`8e827a6`](https://github.com/dragoscirjan/neottia/commit/8e827a6a717ccb4d910d4ca86f592c86b59ecb07), [`c4ecd36`](https://github.com/dragoscirjan/neottia/commit/c4ecd36cd0885fbfb0033cd49e0650115422b0e1), [`3312760`](https://github.com/dragoscirjan/neottia/commit/33127604e15a387d40b6206e82ab3c6e16d62052), [`784b110`](https://github.com/dragoscirjan/neottia/commit/784b110140a3158e9e730732c839e5475348d283), [`d1088a3`](https://github.com/dragoscirjan/neottia/commit/d1088a370c28ee28cd88c8b2f48c4a2bfb052c03), [`5caeb74`](https://github.com/dragoscirjan/neottia/commit/5caeb745dfc8e10b748d00cb6d65aef9018c599b), [`842a04b`](https://github.com/dragoscirjan/neottia/commit/842a04be6d7938d34a711c9faf329fbf21f1eede)]:
  - @neottia/config-registry@0.2.0
  - @neottia/memory-core@0.2.0
