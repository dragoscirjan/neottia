# @neottia/issues-design-docs

Cycle-free composition for Neottia Issues and Design Docs. The package supplies a Design Docs reference resolver for `IssueStore` and an Issues link validator for `DesignDocumentStore` without making either domain depend on the other.

```sh
pnpm add @neottia/issues-design-docs @neottia/issues @neottia/design-docs
```

Resolve the complete official configuration once and pass its snapshot to the composition:

```ts
import { resolveHostConfigSnapshot } from "@neottia/config-registry";
import { createIssuesDesignDocsComposition } from "@neottia/issues-design-docs";

const cwd = process.cwd();
const snapshot = resolveHostConfigSnapshot({ cwd, interactive: true });
export const composition = createIssuesDesignDocsComposition({ cwd, snapshot });
```

Use `interactive: false` for MCP and OpenCode hosts. The official registry helper accepts all published module shards and derives `prompt` stale-cache settings to `rebuild` as labeled runtime overrides without rereading files or mutating the declared snapshot. Pi hosts use `interactive: true` and cache snapshots by canonical invocation cwd.

Pass `composition.resolver` to `IssueStore` and `composition.linkValidator` to `DesignDocumentStore`. The composition captures both typed shards at construction. Its callbacks never reload configuration, so one operation cannot mix settings from different file states. Construct a new snapshot and composition to observe a configuration change.

Standalone callers may omit `snapshot` and provide `issuesConfigOverrides` and `designDocsConfigOverrides`. The package resolves both override sets into one shared snapshot before returning. Do not combine a supplied snapshot with standalone overrides.

Enable both `modules.issues` and `modules.design_docs`; explicit cross-domain validation fails closed with `ISSUES_DISABLED` when Issues is disabled. References use stable IDs: `{kind: 'design-doc', id, version?}`. Unpinned links resolve the latest version, pinned links resolve exact history, and archived versions remain addressable. Validation reads both active and archived canonical Issues. All work runs under the repository lease supplied by the calling domain; the composition never reacquires that lease.

Read the [complete composition guide](https://github.com/dragoscirjan/neottia/blob/main/docs/issues/design-docs.md).
