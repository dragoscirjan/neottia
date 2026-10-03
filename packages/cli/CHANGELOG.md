# @neottia/cli

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
