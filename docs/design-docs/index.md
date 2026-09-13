# Design Docs

Design Docs stores repository-local technical records as canonical Markdown. It supports explicit review and approval, immutable approved versions, search, lineage archive and restore, and migration bundles.

Start with the [requirements](/get-started/requirements), then choose the [library](/design-docs/library), [Pi](/harnesses/pi#design-docs), [OpenCode](/harnesses/opencode#design-docs), or [generic MCP server](/mcp/design-docs).

- [Configure the shard](/design-docs/configuration)
- [Author canonical Markdown](/design-docs/canonical-format)
- [Run the draft, review, approval, and version lifecycle](/design-docs/lifecycle)
- [Call all 13 tools](/design-docs/tools)
- [Validate issue links](/design-docs/issue-links)
- [Import or export](/design-docs/migration)
- [Resolve operational errors](/design-docs/operations)

Canonical Markdown below `.neottia/design-docs/` is authoritative. `.neottia/cache/design-docs.sqlite` is disposable. Follow the [repository file rules](/guides/repository-files).

```yaml
version: 1
modules:
  issues:
    enabled: true # required for cross-domain issue-link validation
  design_docs:
    enabled: true
    root: .neottia/design-docs
    retrieval:
      limit: 20
      snippet_bytes: 512
      all_versions: false
    cache:
      max_age_ms: 300000
      stale_policy: prompt
```

The root is a safe project-relative path. Portable Unicode directory names are valid, while actual `.neottia/cache` and `.neottia/repository-store` paths remain reserved. Configuration is strict and resolves defaults, global and project files, the selected profile, environment bindings, then explicit overrides. The generated package schema lists every security/resource limit.

## Author and review

Create one of `hld`, `lld`, `design-overview`, or `gdd`; creation always starts at v1 `draft`. Update a current draft/review with its exact revision. Transition `draft → review`, `review → draft`, or `review → approved` with explicit intent, actor, and evidence. Evidence identifies a `human-ui`, `caller-attestation`, or `policy` source; non-interactive clients do not pretend a person confirmed.

Approved versions are immutable. Create semantic changes with `document_version` from the latest approved revision; the successor is the next contiguous version in `draft`. Prior bytes remain unchanged.

Canonical Markdown uses bounded YAML frontmatter, UTF-8/LF, a matching sole H1, stable `doc-<ULID>` (plus readable legacy decimal IDs), deterministic filenames, and an exact `v1:<sha256>` revision.

## Find, archive, and link

`document_list` filters metadata. `document_search` performs BM25-ranked FTS5 search with kind/status/location/ID/current-version filters and bounded snippets; every hit is hydrated from canonical Markdown. `document_get` returns full content.

Archive/restore requires the latest exact revision and moves all lineage files atomically. Archived versions remain addressable. Issues should persist `{kind: design-doc, id, version?}` rather than paths. An omitted version means latest; a version pins exact history. Run `document_validate` with `cross_domain: true` to check links in active and archived Issues. Shipped hosts install the cycle-free composition automatically, but both `modules.design_docs` and `modules.issues` must be enabled. The library exports an under-lease address resolver and never imports the Issues package.

## Back up and migrate

`document_export` emits a deterministic digest and exact source bytes. `document_import` defaults to preview, reports all additions/conflicts/unsupported records plus path mappings, and publishes only a fully valid proposed state. For `harnessctl-v2`, explicitly provide `{version: 1, format: "harnessctl-v2-design-documents", documents: [{path, content, location?}]}` with canonical legacy source strings. Neottia never auto-reads or mutates `.harnessctl/documents` or `.specs`.

## Recovery and troubleshooting

Repository-store leases serialize writers, exact revisions reject stale edits, and durable journals recover interrupted multi-file publication. Symlinks, collisions, malformed canonical files, lineage gaps/splits, and operator-modified recovery artifacts fail closed.

SQLite at `.neottia/cache/design-docs.sqlite` is disposable. Missing, corrupt, wrong-version, stale, or contradictory caches rebuild only from valid canonical Markdown. Use `stale_policy: fail` to require operator action. Pi asks before replacing an existing stale cache and preserves it when the user declines; generic MCP and OpenCode are non-interactive and map `prompt` to rebuild. Cache failures never make cache rows authoritative or rewrite canonical documents.

Structured tool errors expose `category`, `code`, `message`, `paths`, `retryable`, and optional bounded diagnostic `details`. Repository-store retryability and evidence remain available across MCP, Pi, and OpenCode.
