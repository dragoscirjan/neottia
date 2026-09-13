# Searchable configuration

The strict `modules.searchable` shard defaults to disabled. Shared hosts resolve defaults, the global file, the project file, the selected profile, environment bindings, and explicit overrides in that order. `loadSearchableConfig()` retains `skills.searchable` only as a deprecated standalone compatibility path.

```yaml
version: 1
modules:
  searchable:
    enabled: true
    root: .neottia/searchable
    search:
      provider: duckduckgo
      limit: 5
      timeout_ms: 10000
      credentials: {}
      bing_api_endpoint: https://api.bing.microsoft.com/v7.0/search
    fetch:
      strategies: [direct, jina, wayback]
      timeout_ms: 10000
      overall_timeout_ms: 20000
      max_response_bytes: 10485760
    grep:
      limit: 5
      snippet_bytes: 512
    ask:
      limit: 3
      context_bytes: 131072
    ollama:
      endpoint: http://localhost:11434
      model: llama3
      timeout_ms: 60000
    cache:
      max_age_ms: 300000
      stale_policy: prompt
    security:
      limits:
        max_query_bytes: 16384
        max_url_bytes: 8192
        max_title_bytes: 4096
        max_content_bytes: 10485760
        max_results: 100
        max_result_bytes: 4194304
        max_storage_bytes: 268435456
```

YAML credentials must be exact environment references such as `${BRAVE_API_KEY}`. Credential leaves are `google_api_key`, `google_cse_id`, `bing_api_key`, and `brave_api_key`. Canonical environment names start with `NEOTTIA_SEARCHABLE_`, including `NEOTTIA_SEARCHABLE_SEARCH_TIMEOUT_MS`; the loader also accepts the legacy Google, Bing, Brave, `OLLAMA_URL`, and `OLLAMA_MODEL` names.

`NEOTTIA_CONFIG_FILE` selects the project file for shared hosts. `NEOTTIA_SEARCHABLE_CONFIG_FILE` and `NEOTTIA_CONFIG_SEARCHABLE_PATH` apply only to the standalone compatibility loader. The [generated JSON Schema](https://github.com/dragoscirjan/neottia/blob/main/packages/searchable-core/config.schema.json) is the machine-readable reference.

Disabled calls fail with `CAPABILITY_DISABLED` before provider, network, storage, cache, or model work starts.
