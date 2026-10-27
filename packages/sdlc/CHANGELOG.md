# @neottia/sdlc

## 0.6.0

### Minor Changes

- [#261](https://github.com/dragoscirjan/neottia/pull/261) [`89f8f11`](https://github.com/dragoscirjan/neottia/commit/89f8f11cd9a57fc0e03de3fd03ce931eca39c013) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add `/neottia-adopt` as the seventh standard lifecycle command. It inventories existing project documents and configured provider records, requires approval of an exact operation plan, and delivers approved document-only changes through a draft pull request.

- [#260](https://github.com/dragoscirjan/neottia/pull/260) [`02b89ed`](https://github.com/dragoscirjan/neottia/commit/02b89ed82dc754bb6551f6e8adfe86046700d756) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Install lifecycle commands as `neottia-plan`, `neottia-build`, `neottia-verify`, `neottia-release`, `neottia-continue`, and `neottia-refresh` while preserving the existing semantic and template identifiers.

- [#256](https://github.com/dragoscirjan/neottia/pull/256) [`e806c58`](https://github.com/dragoscirjan/neottia/commit/e806c58022ef2a7d859f15c0db394432b43e18a8) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add project-scoped, append-only Markdown instructions for individual SDLC commands without replacing canonical lifecycle templates.

## 0.5.1

### Patch Changes

- Updated dependencies [[`01d24e5`](https://github.com/dragoscirjan/neottia/commit/01d24e5ec9099590dd448023d0951e8802bdd2d8)]:
  - @neottia/harness-adapter@0.3.0
  - @neottia/distribution@0.2.1

## 0.5.0

### Minor Changes

- [#187](https://github.com/dragoscirjan/neottia/pull/187) [`0430f7e`](https://github.com/dragoscirjan/neottia/commit/0430f7e936a4d729cc4e2943317b3cb4aad8c9ba) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Integrate Searchable as an optional SDLC lifecycle capability ([#182](https://github.com/dragoscirjan/neottia/issues/182)). The compiler gains a `capabilities.searchable` contribution (`none` | `web`, default `none`) with fail-closed semantics: a `web` selection requires `modules.searchable.enabled`, and the published configuration schema covers the new shard. When enabled, every compiled lifecycle command renders web-retrieval boundaries — search and fetch stay bounded to the enabled capability, every cited page is recorded as a canonical stash through `web_stash`, and local Ollama enrichment runs only where the searchable configuration enables it; web retrieval never authorizes mutation, acquires credentials, contacts undeclared hosts, or bypasses the issue and document authorities. The compiler also now requires the Memory and Searchable boundary fragments to render exactly once in every command so template overrides cannot silently drop them. The CLI initializer accepts `--enable searchable` alongside `--enable memory`, keeping both capabilities disabled by default.

## 0.4.0

### Minor Changes

- [#185](https://github.com/dragoscirjan/neottia/pull/185) [`8873b4f`](https://github.com/dragoscirjan/neottia/commit/8873b4f696b6a3fe1d03d7b24eb611511fdd4cbc) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Integrate Memory as an optional SDLC lifecycle capability ([#181](https://github.com/dragoscirjan/neottia/issues/181)). The compiler gains a `capabilities.memory` contribution (`none` | `filesystem` | `postgres`, default `none`) with fail-closed semantics: a non-`none` selection requires `modules.memory.enabled` and must match the Memory module's own backend, and the published configuration schema covers the new shard. When enabled, every compiled lifecycle command renders durable-memory boundaries — read-only retrieval before planning or resuming work, checkpoint evidence recorded through the `memory_*` authority with exact ownership and revision evidence, and a durable outcome summary before a lifecycle run stops; memory never authorizes mutation or bypasses the issue and document authorities. The CLI initializer gains `--enable memory`, which writes the module enablement and the matching capability provider while keeping Memory disabled by default.

## 0.3.0

### Minor Changes

- [#167](https://github.com/dragoscirjan/neottia/pull/167) [`af87851`](https://github.com/dragoscirjan/neottia/commit/af87851be1ca1371c19f5176f1a53fd070830816) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add the shared Epic-first operating protocol. Compilation now resolves the packaged `neottia.sdlc.protocol` template, carries it as a checksummed `protocol` field in compiler input (schema version 4), and projects one `neottia-sdlc` skill through every adapter. The protocol defines one-owning-Epic resolution, append-only durable checkpoints (`neottia-sdlc:checkpoint`), explicit action-scoped approvals, per-command procedures for Plan, Build, Verify, Release, Continue, and Refresh, and strict handback rules. Override the body via template layers at `.neottia/templates/sdlc/protocol.md`.

## 0.2.0

### Minor Changes

- [#141](https://github.com/dragoscirjan/neottia/pull/141) [`a9ce492`](https://github.com/dragoscirjan/neottia/commit/a9ce492a0767b9603ab00be9cc4a51d934313508) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Compile six packaged Markdown/Twig lifecycle templates and external lifecycle prose into deterministic Pi and OpenCode asset manifests. Load conventional project overrides, insert provider and role fragments with Twing, and record configuration, template, instruction, role, and runtime package provenance.
  
  Export deterministic code-unit ordering from the distribution package for compiler and extension authors.

- [#145](https://github.com/dragoscirjan/neottia/pull/145) [`22444b7`](https://github.com/dragoscirjan/neottia/commit/22444b718e4c96bdfe713636247787595d37eba3) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add the Claude Code harness adapter and generalize SDLC role configuration.
  
  `@neottia/claude-code-adapter` projects Claude Code commands, Agent Skills, custom agents, and project-scoped `.mcp.json` MCP operations. It rejects single-file extension projection and runtime package activation because Claude Code plugins require multi-file plugin packages, and it rejects portable per-tool permission metadata because agent files have no documented representation. `@neottia/sdlc` now accepts role assignment maps for any adapter ID in the portable asset-ID format under `agents.sdlc`, while keeping documented `pi` and `opencode` maps in the lowest-precedence defaults.

- [#144](https://github.com/dragoscirjan/neottia/pull/144) [`b835244`](https://github.com/dragoscirjan/neottia/commit/b83524409e4c432069a98e5210a3397c46cd67db) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add portable compile-time SDLC role assignments, bounded handoff and result contracts, current-agent fallback, and host-aware Pi and OpenCode projection.

- [#142](https://github.com/dragoscirjan/neottia/pull/142) [`3e8bb31`](https://github.com/dragoscirjan/neottia/commit/3e8bb314eb9e00ceb23e81f3522766b33c111795) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add strict forge connections and compile-time GitHub, GitLab, Gitea, and Forgejo instruction bundles with support declarations, tool prerequisites, MCP checks, and equivalent Pi and OpenCode semantics.

- [#143](https://github.com/dragoscirjan/neottia/pull/143) [`c4ecd36`](https://github.com/dragoscirjan/neottia/commit/c4ecd36cd0885fbfb0033cd49e0650115422b0e1) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add independent Bitbucket, Jira, and Confluence instruction packs with strict connections, required MCP routes, mixed-provider compilation, and equivalent Pi and OpenCode semantics.

- [#134](https://github.com/dragoscirjan/neottia/pull/134) [`842a04b`](https://github.com/dragoscirjan/neottia/commit/842a04be6d7938d34a711c9faf329fbf21f1eede) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add typed compile-time provider selections for Issues, Documents, and source control to the official unified configuration.

### Patch Changes

- Updated dependencies [[`20f3913`](https://github.com/dragoscirjan/neottia/commit/20f391389811733db9662e137e0efe53f47dbdbe), [`639505e`](https://github.com/dragoscirjan/neottia/commit/639505e80b9cc2b0c538a9d4e291704cc8c98d7b), [`1db6375`](https://github.com/dragoscirjan/neottia/commit/1db6375b82a6c46b6be5e0899c97b82888b2437c), [`a9ce492`](https://github.com/dragoscirjan/neottia/commit/a9ce492a0767b9603ab00be9cc4a51d934313508), [`fc18529`](https://github.com/dragoscirjan/neottia/commit/fc1852941e092e4cbd51912bfae1bdd6a9264225), [`b4abca1`](https://github.com/dragoscirjan/neottia/commit/b4abca120a43d18bfa34dab4069922e77f3a8362), [`b835244`](https://github.com/dragoscirjan/neottia/commit/b83524409e4c432069a98e5210a3397c46cd67db), [`04e5667`](https://github.com/dragoscirjan/neottia/commit/04e56679fdc4ea05b87af2f7d3e188bad76464e7), [`3e8bb31`](https://github.com/dragoscirjan/neottia/commit/3e8bb314eb9e00ceb23e81f3522766b33c111795), [`c4ecd36`](https://github.com/dragoscirjan/neottia/commit/c4ecd36cd0885fbfb0033cd49e0650115422b0e1), [`3312760`](https://github.com/dragoscirjan/neottia/commit/33127604e15a387d40b6206e82ab3c6e16d62052), [`784b110`](https://github.com/dragoscirjan/neottia/commit/784b110140a3158e9e730732c839e5475348d283), [`d1088a3`](https://github.com/dragoscirjan/neottia/commit/d1088a370c28ee28cd88c8b2f48c4a2bfb052c03), [`8cd0c3a`](https://github.com/dragoscirjan/neottia/commit/8cd0c3a89b9e418077d30db6fa82d9d70b4f2f15), [`7344aa0`](https://github.com/dragoscirjan/neottia/commit/7344aa03b290cffa96ceded5c6988118f46618f4), [`5caeb74`](https://github.com/dragoscirjan/neottia/commit/5caeb745dfc8e10b748d00cb6d65aef9018c599b), [`b35c677`](https://github.com/dragoscirjan/neottia/commit/b35c677aa8c197de41284c6c7e2ca661a5484ceb), [`842a04b`](https://github.com/dragoscirjan/neottia/commit/842a04be6d7938d34a711c9faf329fbf21f1eede), [`18a0b73`](https://github.com/dragoscirjan/neottia/commit/18a0b7301b45d7744efc8e609336e2a54db7665e), [`6113723`](https://github.com/dragoscirjan/neottia/commit/61137236edab2523bcf8783470c59159aa8f2075)]:
  - @neottia/harness-adapter@0.2.0
  - @neottia/issues@0.2.0
  - @neottia/config@0.2.0
  - @neottia/distribution@0.2.0
  - @neottia/design-docs@0.2.0
