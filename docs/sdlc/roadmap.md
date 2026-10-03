# Capability roadmap

Neottia ships the SDLC as bounded slices. This page states what each capability is today: available, experimental, planned, or rejected by default. Epic [#162](https://github.com/dragoscirjan/neottia/issues/162) tracks the post-MVP decomposition and reviews every deferred workstream against real first-use evidence.

## Status meanings

| Status              | Meaning                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Available           | Ships in releases today and is covered by deterministic acceptance tests.                          |
| Experimental        | Installable today, but not yet covered by full lifecycle boundaries or first-user evidence.        |
| Planned             | Accepted for future work with a tracking issue; not installable through the supported surface yet. |
| Rejected by default | Exists only behind a separate reviewed design and an explicit approval contract.                   |

## Available

- **Project initialization** — `neottia init` writes the minimal project configuration for Pi and OpenCode with the `local` preset. See [shared configuration](/get-started/configuration).
- **Lifecycle installation** — `neottia plan --manifest manifest.json` plus `neottia apply` compile and install the six commands, the operating-protocol skill, and exact runtime package entries; `neottia doctor` reports gaps without changing anything. The config-driven `neottia sdlc plan` flow arrives with [#179](https://github.com/dragoscirjan/neottia/pull/179).
- **Receipt-driven updates and uninstall** — plans are digest-protected, repeated installs are idempotent, and uninstall removes only receipt-owned files and host-configuration entries.
- **Filesystem Issues and Design Docs** — enabled by initialization; canonical records live under `.neottia/issues/` and `.neottia/design-docs/`.
- **Local Git source control** — commits stay scoped and reviewable; push, pull requests, and merges require explicit authorization.
- **Global-scope installation** — available through explicit `scope: global` targets in the project configuration or the `neottia apply --scope global` override; project scope remains the default.

## Experimental

These modules already ship runtime packages and CLI catalog entries, so a project that enables them manually receives exact package configuration through `neottia apply`. They are experimental because the compiled lifecycle commands carry no capability boundaries for them yet.

- **Memory** (`modules.memory.enabled`) — durable memory records under `.neottia/memory/`. Lifecycle integration (retrieval, checkpoint, and shutdown boundaries) is tracked in [#181](https://github.com/dragoscirjan/neottia/issues/181).
- **Searchable** (`modules.searchable.enabled`) — stashed web records under `.neottia/searchable/`. Lifecycle integration (network, stash, citation, and local-Ollama boundaries) is tracked in [#182](https://github.com/dragoscirjan/neottia/issues/182).

## Planned

Accepted workstreams with tracking issues; each becomes independently releasable with its own Changesets and documentation.

- **Remote provider setup and diagnostics** — first-run configuration for remote Issues, Documents, and source-control providers, with configuration references, runtime installation, credentials, and authentication kept separate. Deferred pending first-user evidence ([#162](https://github.com/dragoscirjan/neottia/issues/162)).
- **Generic MCP configuration journeys** — installation and configuration guidance for hosts without native MCP support. Same separation requirements apply.
- **Interactive configuration wizard** — built on top of the deterministic initializer; discovery and recommendations never silently select credentials or mutation routes.
- **Runtime orchestration evaluations** — durable runtime state, model-tier routing and retries, managed Git worktrees, and grouped `/work` dispatch aliases are evaluated separately and only with explicit cost and authority boundaries.
- **Claude Code distribution** — coordinated through [#119](https://github.com/dragoscirjan/neottia/issues/119) when the host format can be represented safely.

## Rejected by default

- **Autonomous merge, deployment, publication, remote closure, and destructive actions.** The compiled Release contract stops before every irreversible action and requires fresh, action-specific approval. No roadmap item grants authority for these actions; a future implementation requires a dedicated reviewed story, explicit user-authorization contracts, and rollback and monitoring evidence.
