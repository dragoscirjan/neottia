# Design Docs configuration

The strict `skills.design_docs` shard rejects unknown keys. Values resolve as explicit override, environment, file, then default.

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

`root` must be a portable project-relative path and cannot overlap `.neottia/cache` or `.neottia/repository-store`.

Environment bindings are `NEOTTIA_DESIGN_DOCS_ENABLED`, `NEOTTIA_DESIGN_DOCS_ROOT`, `NEOTTIA_DESIGN_DOCS_RETRIEVAL_LIMIT`, `NEOTTIA_DESIGN_DOCS_SNIPPET_BYTES`, `NEOTTIA_DESIGN_DOCS_ALL_VERSIONS`, `NEOTTIA_DESIGN_DOCS_CACHE_MAX_AGE_MS`, and `NEOTTIA_DESIGN_DOCS_CACHE_STALE_POLICY`. `NEOTTIA_CONFIG_FILE` or `NEOTTIA_DESIGN_DOCS_CONFIG_FILE` selects a file. `NEOTTIA_CONFIG_DESIGN_DOCS_PATH` selects the shard.

Security limit defaults are:

| Leaf                    |    Default |
| ----------------------- | ---------: |
| `max_files`             |      2,000 |
| `max_versions`          |        100 |
| `max_file_bytes`        |  1,100,000 |
| `max_body_bytes`        |  1,000,000 |
| `max_frontmatter_bytes` |    131,072 |
| `max_metadata_bytes`    |     65,536 |
| `max_aggregate_bytes`   |  8,388,608 |
| `max_yaml_depth`        |         16 |
| `max_yaml_nodes`        |      2,048 |
| `max_metadata_keys`     |        256 |
| `max_journal_bytes`     |  4,194,304 |
| `max_backup_bytes`      | 33,554,432 |
| `max_query_bytes`       |     16,384 |
| `max_results`           |        200 |
| `max_result_bytes`      |  4,194,304 |
| `max_import_bytes`      | 67,108,864 |

These limits have no environment bindings. The shipped [JSON Schema](https://github.com/dragoscirjan/neottia/blob/main/packages/design-docs/config.schema.json) is the machine-readable reference.
