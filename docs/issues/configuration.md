# Issues configuration

The strict `skills.issues` shard rejects unknown keys. Explicit library values override environment bindings, which override YAML and defaults.

```yaml
version: 1
skills:
  issues:
    enabled: true
    root: .neottia/issues
    prefix: issue-
    retrieval:
      limit: 20
      max_bytes: 1048576
    cache:
      max_age_ms: 300000
      stale_policy: prompt
    lock:
      wait_ms: 10000
      stale_ms: 60000
    security:
      max_file_bytes: 1048576
      max_files: 10000
      max_total_bytes: 67108864
      max_batch_paths: 1000
      max_query_bytes: 16384
      max_query_rows: 10000
      max_result_bytes: 16777216
```

The root is a safe project-relative path. It cannot overlap `.neottia/cache` or `.neottia/repository-store`. Prefixes match `^[a-z][a-z0-9-]{0,31}$`.

Bindings are `NEOTTIA_ISSUES_ENABLED`, `_ROOT`, `_PREFIX`, `_RETRIEVAL_LIMIT`, `_RETRIEVAL_MAX_BYTES`, `_CACHE_MAX_AGE_MS`, `_CACHE_STALE_POLICY`, `_LOCK_WAIT_MS`, `_LOCK_STALE_MS`, `_MAX_FILE_BYTES`, `_MAX_FILES`, `_MAX_TOTAL_BYTES`, `_MAX_BATCH_PATHS`, `_MAX_QUERY_BYTES`, `_MAX_QUERY_ROWS`, and `_MAX_RESULT_BYTES`, each prefixed with `NEOTTIA_ISSUES`. File selectors are `NEOTTIA_CONFIG_FILE`, `NEOTTIA_ISSUES_CONFIG_FILE`, and `NEOTTIA_CONFIG_ISSUES_PATH`.

The shipped [JSON Schema](https://github.com/dragoscirjan/neottia/blob/main/packages/issues/config.schema.json) is the machine-readable reference. Disabled tools reject before creating roots, leases, or caches.
