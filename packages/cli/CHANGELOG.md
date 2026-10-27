# @neottia/cli

## 0.9.0

### Minor Changes

- [#260](https://github.com/dragoscirjan/neottia/pull/260) [`02b89ed`](https://github.com/dragoscirjan/neottia/commit/02b89ed82dc754bb6551f6e8adfe86046700d756) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Install lifecycle commands as `neottia-plan`, `neottia-build`, `neottia-verify`, `neottia-release`, `neottia-continue`, and `neottia-refresh` while preserving the existing semantic and template identifiers.

- [#256](https://github.com/dragoscirjan/neottia/pull/256) [`e806c58`](https://github.com/dragoscirjan/neottia/commit/e806c58022ef2a7d859f15c0db394432b43e18a8) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add project-scoped, append-only Markdown instructions for individual SDLC commands without replacing canonical lifecycle templates.

### Patch Changes

- Updated dependencies [[`02b89ed`](https://github.com/dragoscirjan/neottia/commit/02b89ed82dc754bb6551f6e8adfe86046700d756), [`e806c58`](https://github.com/dragoscirjan/neottia/commit/e806c58022ef2a7d859f15c0db394432b43e18a8)]:
  - @neottia/sdlc@0.6.0
  - @neottia/config-registry@0.4.1

## 0.8.0

### Minor Changes

- [#249](https://github.com/dragoscirjan/neottia/pull/249) [`01d24e5`](https://github.com/dragoscirjan/neottia/commit/01d24e5ec9099590dd448023d0951e8802bdd2d8) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add supported Claude Code lifecycle distribution. The CLI now initializes, plans, installs, diagnoses, and uninstalls Claude Code assets, while the adapter maps exact Neottia runtime packages to project-scoped `.mcp.json` stdio servers.

### Patch Changes

- Updated dependencies [[`01d24e5`](https://github.com/dragoscirjan/neottia/commit/01d24e5ec9099590dd448023d0951e8802bdd2d8)]:
  - @neottia/harness-adapter@0.3.0
  - @neottia/claude-code-adapter@0.3.0
  - @neottia/opencode-adapter@0.2.1
  - @neottia/pi-adapter@0.2.1
  - @neottia/distribution@0.2.1
  - @neottia/sdlc@0.5.1

## 0.7.2

### Patch Changes

- [#244](https://github.com/dragoscirjan/neottia/pull/244) [`3fa7bf5`](https://github.com/dragoscirjan/neottia/commit/3fa7bf57f687c9939dd1116673aced098755f73d) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add platform-aware Repository Store diagnostics and clean packed-package acceptance for every certified operating system tuple.
- Updated dependencies [[`3fa7bf5`](https://github.com/dragoscirjan/neottia/commit/3fa7bf57f687c9939dd1116673aced098755f73d)]:
  - @neottia/repository-store@0.3.4
  - @neottia/searchable-core@0.2.6

## 0.7.1

### Patch Changes

- [#206](https://github.com/dragoscirjan/neottia/pull/206) [`ffe774e`](https://github.com/dragoscirjan/neottia/commit/ffe774ed19e63ad542cc59f5687ba88b3facc3c5) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Preserve receipt symlink rejection across physical path aliases and reject relative Memory roots with symlinked ancestors before creating repository authority artifacts.
- Updated dependencies [[`ffe774e`](https://github.com/dragoscirjan/neottia/commit/ffe774ed19e63ad542cc59f5687ba88b3facc3c5)]:
  - @neottia/memory-core@0.3.1
  - @neottia/searchable-core@0.2.1

## 0.7.0

### Minor Changes

- [#187](https://github.com/dragoscirjan/neottia/pull/187) [`0430f7e`](https://github.com/dragoscirjan/neottia/commit/0430f7e936a4d729cc4e2943317b3cb4aad8c9ba) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Integrate Searchable as an optional SDLC lifecycle capability ([#182](https://github.com/dragoscirjan/neottia/issues/182)). The compiler gains a `capabilities.searchable` contribution (`none` | `web`, default `none`) with fail-closed semantics: a `web` selection requires `modules.searchable.enabled`, and the published configuration schema covers the new shard. When enabled, every compiled lifecycle command renders web-retrieval boundaries — search and fetch stay bounded to the enabled capability, every cited page is recorded as a canonical stash through `web_stash`, and local Ollama enrichment runs only where the searchable configuration enables it; web retrieval never authorizes mutation, acquires credentials, contacts undeclared hosts, or bypasses the issue and document authorities. The compiler also now requires the Memory and Searchable boundary fragments to render exactly once in every command so template overrides cannot silently drop them. The CLI initializer accepts `--enable searchable` alongside `--enable memory`, keeping both capabilities disabled by default.

### Patch Changes

- Updated dependencies [[`0430f7e`](https://github.com/dragoscirjan/neottia/commit/0430f7e936a4d729cc4e2943317b3cb4aad8c9ba)]:
  - @neottia/sdlc@0.5.0
  - @neottia/config-registry@0.4.0

## 0.6.0

### Minor Changes

- [#185](https://github.com/dragoscirjan/neottia/pull/185) [`8873b4f`](https://github.com/dragoscirjan/neottia/commit/8873b4f696b6a3fe1d03d7b24eb611511fdd4cbc) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Integrate Memory as an optional SDLC lifecycle capability ([#181](https://github.com/dragoscirjan/neottia/issues/181)). The compiler gains a `capabilities.memory` contribution (`none` | `filesystem` | `postgres`, default `none`) with fail-closed semantics: a non-`none` selection requires `modules.memory.enabled` and must match the Memory module's own backend, and the published configuration schema covers the new shard. When enabled, every compiled lifecycle command renders durable-memory boundaries — read-only retrieval before planning or resuming work, checkpoint evidence recorded through the `memory_*` authority with exact ownership and revision evidence, and a durable outcome summary before a lifecycle run stops; memory never authorizes mutation or bypasses the issue and document authorities. The CLI initializer gains `--enable memory`, which writes the module enablement and the matching capability provider while keeping Memory disabled by default.

### Patch Changes

- Updated dependencies [[`8873b4f`](https://github.com/dragoscirjan/neottia/commit/8873b4f696b6a3fe1d03d7b24eb611511fdd4cbc)]:
  - @neottia/sdlc@0.4.0
  - @neottia/config-registry@0.3.0

## 0.5.0

### Minor Changes

- [#179](https://github.com/dragoscirjan/neottia/pull/179) [`5e8ed39`](https://github.com/dragoscirjan/neottia/commit/5e8ed39a35bd804d29b38bb954e0885cd96cd96b) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add the config-driven `neottia sdlc plan` command and the `init --preset local` option, completing the empty-project adoption journey: `init` → `sdlc plan` → inspect the saved plan → `apply --plan` → `doctor`. `sdlc plan` compiles the configured lifecycle exactly like `apply`, writes the reviewable installation plan to `--output` (mutations, checksums, conflicts, reload notice) and optionally the compiled manifest to `--manifest` for `neottia doctor --manifest` diagnostics; it exits 2 while unapproved conflicts remain and supports `--approve <conflict-id>`. Re-running a saved plan is idempotent, update plans are bounded to changed assets, and uninstall stays receipt-driven.

## 0.4.1

### Patch Changes

- Updated dependencies [[`545c986`](https://github.com/dragoscirjan/neottia/commit/545c98617fbca8eec316564f66a67893e1d26fed), [`bbd40be`](https://github.com/dragoscirjan/neottia/commit/bbd40be53f4f7af19388856e5516c06909b63bba)]:
  - @neottia/memory-core@0.3.0
  - @neottia/config-registry@0.2.2

## 0.4.0

### Minor Changes

- [#168](https://github.com/dragoscirjan/neottia/pull/168) [`9c1027d`](https://github.com/dragoscirjan/neottia/commit/9c1027de7d311bb098a6322d0b1040ca9020b52f) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add the config-driven lifecycle workflow: `neottia apply` compiles and installs the SDLC lifecycle from project configuration for every configured harness (skipping conflicting files with per-file warnings and a non-zero exit), `neottia doctor` validates configuration and statically reports missing modules and installs, and `neottia init` validates an existing `.neottia/config.yml` instead of refusing to touch it. A compatibility catalog pins exact runtime package versions per harness, never resolved from a registry. The advanced manifest-driven commands remain unchanged.

### Patch Changes

- Updated dependencies [[`af87851`](https://github.com/dragoscirjan/neottia/commit/af87851be1ca1371c19f5176f1a53fd070830816)]:
  - @neottia/sdlc@0.3.0
  - @neottia/config-registry@0.2.1

## 0.3.0

### Minor Changes

- [#163](https://github.com/dragoscirjan/neottia/pull/163) [`0fe1303`](https://github.com/dragoscirjan/neottia/commit/0fe1303c8286c5addb612de06a5de086a1089ccf) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add `neottia init` to create the minimal project-local SDLC configuration. The repeatable `--harness` option accepts `pi` and `opencode`, writes one project installation target and one required-role map per selected harness, validates the result through the official configuration registry, and never replaces an existing `.neottia/config.yml`.

## 0.2.0

### Minor Changes

- [#139](https://github.com/dragoscirjan/neottia/pull/139) [`d1088a3`](https://github.com/dragoscirjan/neottia/commit/d1088a370c28ee28cd88c8b2f48c4a2bfb052c03) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add declarative asset manifests, entry-level ownership receipts, transactional apply and recovery, deterministic template resolution, isolated static-skill staging, installation configuration, doctor checks, and the `neottia` CLI.

### Patch Changes

- Updated dependencies [[`a9ce492`](https://github.com/dragoscirjan/neottia/commit/a9ce492a0767b9603ab00be9cc4a51d934313508), [`d1088a3`](https://github.com/dragoscirjan/neottia/commit/d1088a370c28ee28cd88c8b2f48c4a2bfb052c03)]:
  - @neottia/distribution@0.2.0
