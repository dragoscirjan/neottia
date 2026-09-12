# @neottia/issues

Filesystem-canonical issue management for Neottia. Each issue is a deterministic YAML file in `.neottia/issues`; `.neottia/cache/issues.sqlite` is a disposable FTS5/BM25 projection and is never authority.

```sh
pnpm add @neottia/issues
```

Read the [Issues user guide](https://github.com/dragoscirjan/neottia/blob/main/docs/issues/index.md) and [library reference](https://github.com/dragoscirjan/neottia/blob/main/docs/issues/library.md).

```ts
import { IssueStore, loadIssueConfig } from "@neottia/issues";

const cwd = process.cwd();
const store = new IssueStore(loadIssueConfig(cwd, { enabled: true }), cwd);
const issue = await store.create({
  type: "story",
  title: "Add a deployment status page",
  created_by: "user:owner",
});
console.log(issue.id, issue.revision);
```

## Configure

Issues contributes `modules.issues` to the shared `@neottia/config` platform:

```yaml
version: 1
modules:
  issues:
    enabled: true
    root: .neottia/issues
    prefix: issue-
    cache:
      stale_policy: rebuild
```

Register `issueConfigContribution` in a multi-module registry and pass the immutable shard to `new IssueStore(snapshot.get(issueConfigContribution), cwd)`. Direct typed `IssueConfig` values remain supported. `loadIssueConfig()` is the synchronous standalone compatibility wrapper; it still accepts the deprecated `skills.issues` path, Issues-only file/path variables, all `NEOTTIA_ISSUES_*` value bindings, and explicit overrides. Resolution order is defaults, global file, project file, selected global/project profile, environment, then explicit overrides. See the [Issues configuration guide](../../docs/issues/configuration) for module settings and the [unified configuration guide](../../docs/configuration.md) for shared files, profiles, provenance, and migration.

Use `IssueStore` directly or `ISSUE_TOOLS` for the shared Zod-validated 17-tool surface. Mutations use repository-wide leases, durable batches, exact `v1:<sha256>` byte revisions, and complete graph validation. Explicit no-op writes repair noncanonical YAML without changing `updated_at`. Update/transition/archive/restore and destructive relation/link calls require the latest revision. Search clamps caller budgets to security ceilings, uses BM25, and rereads canonical YAML before returning results. Its disposable cache health-checks structured metadata, hierarchy, relationships, comments, links, and revision projections without making them authority.

Hosts compose typed design-document validation by injecting `DesignDocumentReferenceResolver`. The MCP `createIssueServer`, Pi `registerIssueTools`, and OpenCode `createIssuesPlugin` APIs all accept this seam. Import previews by default; legacy decimal IDs/comments are preserved, while path links require `importLegacyPath` mapping. Operational errors retain machine-readable category/code/retryability/details.

Commit `.neottia/issues/**/*.yml`; do not commit `.neottia/cache/`. Root components cannot end in a period. Never configure the issue root as `.neottia` or to overlap `.neottia/cache` or `.neottia/repository-store`.

The user guide covers schemas, tools, migration, recovery, and troubleshooting.
