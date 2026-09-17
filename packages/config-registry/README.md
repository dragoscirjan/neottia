# @neottia/config-registry

`@neottia/config-registry` composes the official Memory, Issues, Design Docs, Searchable, SDLC capability, and asset distribution contributions into the strict registry used by Neottia hosts. Use it when a host must accept the complete root configuration even if that host exposes tools for only one module.

```ts
import { resolveHostConfigSnapshot } from "@neottia/config-registry";
import { memoryConfigContribution } from "@neottia/memory-core";

const snapshot = resolveHostConfigSnapshot({
  cwd: process.cwd(),
  interactive: true,
});
export const memory = snapshot.get(memoryConfigContribution);
```

`officialConfigContributions` exposes the immutable contribution list, and `officialConfigRegistry` exposes its validated registry. Root files remain strict. Unknown keys fail validation, while every shard published in the [unified configuration guide](../../docs/configuration.md) can coexist in one file. The registry includes compile-time forge connections under `connections.forges` for GitHub, GitLab, Gitea, and Forgejo.

The registry exports schemas and contributions for `harnesses.install`, `assets.install`, and `templates.install`. They declare harness targets, exact static skill sources, and explicit template packages or overrides. Configuration resolution does not install these assets.

Set `interactive: false` for MCP and OpenCode hosts. The resolver derives Memory, Issues, and Design Docs `prompt` cache policies to `rebuild` without mutating the declared snapshot or rereading configuration. Pi hosts use `interactive: true` and should cache snapshots by canonical invocation cwd.

`@neottia/config-registry` owns only official composition. The generic parser, registry contracts, diagnostics, provenance, and snapshots remain in `@neottia/config`; domain schemas remain in their domain packages.
