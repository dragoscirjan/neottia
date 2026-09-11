# @neottia/issues

Filesystem-canonical issue management for Neottia. Each issue is a deterministic YAML file in `.neottia/issues`; `.neottia/cache/issues.sqlite` is a disposable FTS5/BM25 projection and is never authority.

## Configure

```yaml
version: 1
skills:
  issues:
    enabled: true
    root: .neottia/issues
    prefix: issue-
    cache:
      stale_policy: rebuild
```

Use `IssueStore` directly or `ISSUE_TOOLS` for the shared Zod-validated 17-tool surface. Mutations use repository-wide leases, durable batches, exact `v1:<sha256>` byte revisions, and complete graph validation. Explicit no-op writes repair noncanonical YAML without changing `updated_at`. Update/transition/archive/restore and destructive relation/link calls require the latest revision. Search clamps caller budgets to security ceilings, uses BM25, and rereads canonical YAML before returning results. Its disposable cache health-checks structured metadata, hierarchy, relationships, comments, links, and revision projections without making them authority.

Hosts compose typed design-document validation by injecting `DesignDocumentReferenceResolver`. The MCP `createIssueServer`, Pi `registerIssueTools`, and OpenCode `createIssuesPlugin` APIs all accept this seam. Import previews by default; legacy decimal IDs/comments are preserved, while path links require `importLegacyPath` mapping. Operational errors retain machine-readable category/code/retryability/details.

Commit `.neottia/issues/**/*.yml`; do not commit `.neottia/cache/`. Root components cannot end in a period. Never configure the issue root as `.neottia` or to overlap `.neottia/cache` or `.neottia/repository-store`.

See the [Issues user guide](../../docs/issues/) for schemas, tools, migration, recovery, and troubleshooting.
