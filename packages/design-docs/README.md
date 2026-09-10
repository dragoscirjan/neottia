# @neottia/design-docs

Repository-local, versioned design documents for Neottia. Canonical Markdown is the sole authority; a domain-owned SQLite FTS5 database is a disposable search cache.

## Configuration

Enable the strict shard in `.neottia/config.yml`:

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
      stale_policy: prompt # prompt | rebuild | fail
```

`root` must be a safe project-relative path. Environment overrides include `NEOTTIA_DESIGN_DOCS_ENABLED`, `NEOTTIA_DESIGN_DOCS_ROOT`, `NEOTTIA_DESIGN_DOCS_RETRIEVAL_LIMIT`, `NEOTTIA_DESIGN_DOCS_SNIPPET_BYTES`, `NEOTTIA_DESIGN_DOCS_ALL_VERSIONS`, `NEOTTIA_DESIGN_DOCS_CACHE_MAX_AGE_MS`, and `NEOTTIA_DESIGN_DOCS_CACHE_STALE_POLICY`. Explicit library overrides take precedence over environment values, which take precedence over file leaves and defaults. Security limits are documented by the published `config.schema.json`.

## Authority and authoring

Files live under `.neottia/design-docs/`; archived lineages live under its `archive/` directory. New IDs are `doc-` plus an uppercase Crockford ULID. Existing `doc-00001`-style IDs remain readable and importable but are never allocated. Filenames are deterministic: `<id>-<title-slug>-v<N>.md`.

Frontmatter has only `id`, `title`, `kind`, `status`, `version`, `created_at`, `updated_at`, optional `created_by`, and optional JSON `metadata`. Kinds are `hld`, `lld`, `design-overview`, and `gdd`. Bodies begin with exactly `# <title>` and a blank line and contain no other H1. Input must be canonical UTF-8/LF; ambiguous YAML, aliases, anchors, tags, directives, unknown fields, controls, and configured limit violations are rejected. Revisions are `v1:<sha256-of-exact-bytes>`.

## Review, approval, and versions

`document_create` always creates v1 in `draft`. `document_update` edits only the latest active `draft` or `review` and requires `expected_revision`. `document_transition` permits `draft → review`, `review → draft`, and `review → approved`; it requires an actor, explicit intent, and evidence whose source is `human-ui`, `caller-attestation`, or `policy`. The domain records the assertion and never manufactures human confirmation.

Approval is terminal for that version. Approved bytes cannot be updated. `document_version` requires the latest approved exact revision and creates the contiguous successor as `draft`, preserving every prior byte, ID, and creation time.

## Search, archive, links, and migration

`document_search` uses FTS5/BM25 and supports kind, status, location, ID, current/all-version, and result-limit filters. Hits are deterministically ordered and hydrated from the same valid canonical snapshot; use `document_get` for full content. The cache at `.neottia/cache/design-docs.sqlite` can always be rebuilt and is never authority.

Archive and restore require the latest revision and durably move the complete lineage in one recoverable repository-store batch. There is no physical-delete tool. Stable issue references use `{kind: design-doc, id, version?}`: omitted version resolves latest, pinned versions resolve exactly, and archived versions remain addressable. `resolveAddressesUnderLease` is the cycle-free composition seam; Design Docs does not import or mutate Issues.

`document_export` produces a deterministic, digested bundle containing exact canonical bytes. `document_import` defaults to preview and reports additions, conflicts, unsupported records, warnings, and legacy-to-Neottia path mappings before mutation. For `format: harnessctl-v2`, supply an explicit JSON `{version: 1, format: "harnessctl-v2-design-documents", documents: [{path, content, location?}]}` bundle of canonical legacy sources; the package never scans or mutates `.harnessctl` or `.specs`.

## Concurrency, recovery, and troubleshooting

All reads and mutations use the repository authority lease. Mutations validate a complete proposed snapshot before publication; rename and lineage moves use exact-revision durable batches. Interrupted journals recover at the next lease. Symlinks, hard links, portable path collisions, stale revisions, split/gapped lineages, and operator-modified recovery artifacts fail closed.

If search reports a missing, corrupt, incompatible, stale, or contradictory cache, choose `rebuild`; canonical validation must pass first. If a revision mismatch occurs, fetch the latest record and intentionally retry. Never hand-edit an approved file or cache database.

## Delivery surfaces

Use `@neottia/design-docs-mcp` for generic stdio MCP, `@neottia/pi-design-docs` for Pi, or `@neottia/opencode-design-docs` for OpenCode. All consume the same thirteen Zod-derived input/output/error contracts.
