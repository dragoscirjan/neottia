# @neottia/cli

## 0.3.0

### Minor Changes

- [#163](https://github.com/dragoscirjan/neottia/pull/163) [`0fe1303`](https://github.com/dragoscirjan/neottia/commit/0fe1303c8286c5addb612de06a5de086a1089ccf) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add `neottia init` to create the minimal project-local SDLC configuration. The repeatable `--harness` option accepts `pi` and `opencode`, writes one project installation target and one required-role map per selected harness, validates the result through the official configuration registry, and never replaces an existing `.neottia/config.yml`.

## 0.2.0

### Minor Changes

- [#139](https://github.com/dragoscirjan/neottia/pull/139) [`d1088a3`](https://github.com/dragoscirjan/neottia/commit/d1088a370c28ee28cd88c8b2f48c4a2bfb052c03) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add declarative asset manifests, entry-level ownership receipts, transactional apply and recovery, deterministic template resolution, isolated static-skill staging, installation configuration, doctor checks, and the `neottia` CLI.

### Patch Changes

- Updated dependencies [[`a9ce492`](https://github.com/dragoscirjan/neottia/commit/a9ce492a0767b9603ab00be9cc4a51d934313508), [`d1088a3`](https://github.com/dragoscirjan/neottia/commit/d1088a370c28ee28cd88c8b2f48c4a2bfb052c03)]:
  - @neottia/distribution@0.2.0
