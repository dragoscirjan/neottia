# Design Docs

Neottia Design Docs provides strict repository-local design records, explicit review/approval, immutable approved versions, ranked search, complete-lineage archive/restore, and explicit migration bundles.

## Install and enable

Choose the library (`@neottia/design-docs`), generic MCP server (`@neottia/design-docs-mcp`), or in-process `@neottia/pi-design-docs` / `@neottia/opencode-design-docs` extension. Enable it:

```yaml
version: 1
skills:
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

The root is project-relative. Configuration is strict and resolves each leaf as explicit override, environment, file, then default. The generated package schema lists every security/resource limit.

## Author and review

Create one of `hld`, `lld`, `design-overview`, or `gdd`; creation always starts at v1 `draft`. Update a current draft/review with its exact revision. Transition `draft → review`, `review → draft`, or `review → approved` with explicit intent, actor, and evidence. Evidence identifies a `human-ui`, `caller-attestation`, or `policy` source; non-interactive clients do not pretend a person confirmed.

Approved versions are immutable. Create semantic changes with `document_version` from the latest approved revision; the successor is the next contiguous version in `draft`. Prior bytes remain unchanged.

Canonical Markdown uses bounded YAML frontmatter, UTF-8/LF, a matching sole H1, stable `doc-<ULID>` (plus readable legacy decimal IDs), deterministic filenames, and an exact `v1:<sha256>` revision.

## Find, archive, and link

`document_list` filters metadata. `document_search` performs BM25-ranked FTS5 search with kind/status/location/ID/current-version filters and bounded snippets; every hit is hydrated from canonical Markdown. `document_get` returns full content.

Archive/restore requires the latest exact revision and moves all lineage files atomically. Archived versions remain addressable. Issues should persist `{kind: design-doc, id, version?}` rather than paths. An omitted version means latest; a version pins exact history. The library exports an under-lease address resolver and never imports the Issues package.

## Back up and migrate

`document_export` emits a deterministic digest and exact source bytes. `document_import` defaults to preview, reports all additions/conflicts/unsupported records plus path mappings, and publishes only a fully valid proposed state. For `harnessctl-v2`, explicitly provide `{version: 1, format: "harnessctl-v2-design-documents", documents: [{path, content, location?}]}` with canonical legacy source strings. Neottia never auto-reads or mutates `.harnessctl/documents` or `.specs`.

## Recovery and troubleshooting

Repository-store leases serialize writers, exact revisions reject stale edits, and durable journals recover interrupted multi-file publication. Symlinks, collisions, malformed canonical files, lineage gaps/splits, and operator-modified recovery artifacts fail closed.

SQLite at `.neottia/cache/design-docs.sqlite` is disposable. Missing, corrupt, wrong-version, stale, or contradictory caches rebuild only from valid canonical Markdown. Use `stale_policy: fail` to require operator action; generic MCP maps `prompt` to `rebuild`. Cache failures never make cache rows authoritative or rewrite canonical documents.
