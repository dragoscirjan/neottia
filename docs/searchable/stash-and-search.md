# Stash and local search

`web_stash` stores a normalized page as canonical JSON below:

```text
.neottia/searchable/pages/<sha256-of-normalized-url>.json
```

The record includes the format version, URL, title, content, `created_at`, `updated_at`, and optional excerpt, site, and source fields. Re-stashing the same normalized URL updates the same record. Canonical writes use `@neottia/repository-store` conflict and filesystem checks and honor `max_storage_bytes`.

`.neottia/cache/searchable.sqlite` is a disposable FTS5 cache. It records the canonical snapshot generation and rebuilds from canonical files after a clean start, generation mismatch, integrity failure, or permitted stale cache. It is not authority and can be deleted while no Searchable process is using it.

The cache has a separate disk bound because FTS5 stores text and term indexes in SQLite pages and may use WAL files while rebuilding. Its limit is eight times `max_storage_bytes` plus 8 MiB for fixed SQLite schema and journal overhead. This cache allowance does not increase the canonical storage quota.

`web_grep` converts the bounded query into literal FTS terms, ranks candidates with BM25, and reloads every result from canonical JSON. Returned snippets are bounded UTF-8 windows from canonical content, not cache-owned copies.

A stale cache follows `cache.stale_policy`:

- `rebuild`: rebuild automatically
- `fail`: return `STASH_CACHE_REBUILD_REQUIRED`
- `prompt`: Pi asks; MCP and OpenCode rebuild because they have no interactive confirmation channel
