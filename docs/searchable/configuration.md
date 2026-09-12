# Searchable foundation configuration

> Searchable is foundation-only. Configuration does not create providers, storage, extraction, or model clients.

The strict `skills.searchable` shard defaults to disabled. Resolution is explicit override, environment, file, then default.

```yaml
version: 1
skills:
  searchable:
    enabled: false
    root: .neottia/searchable
    search:
      provider: duckduckgo
      limit: 5
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

Credential file values must be exact environment references. The credential leaves are `google_api_key`, `google_cse_id`, `bing_api_key`, and `brave_api_key`. Canonical bindings are `NEOTTIA_SEARCHABLE_ENABLED`, `NEOTTIA_SEARCHABLE_ROOT`, `NEOTTIA_SEARCHABLE_PROVIDER`, `NEOTTIA_SEARCHABLE_SEARCH_LIMIT`, the four `NEOTTIA_SEARCHABLE_*` credential names, `NEOTTIA_SEARCHABLE_BING_API_ENDPOINT`, `NEOTTIA_SEARCHABLE_GREP_LIMIT`, `NEOTTIA_SEARCHABLE_ASK_LIMIT`, `NEOTTIA_SEARCHABLE_OLLAMA_URL`, and `NEOTTIA_SEARCHABLE_OLLAMA_MODEL`. The loader also accepts the exported legacy Google, Bing, Brave, and Ollama aliases. `NEOTTIA_CONFIG_FILE`, `NEOTTIA_SEARCHABLE_CONFIG_FILE`, and `NEOTTIA_CONFIG_SEARCHABLE_PATH` select the source.

Security defaults cap queries at 16,384 UTF-8 bytes, URLs at 8,192, titles at 4,096, content at 10,485,760, results at 100, serialized output at 4,194,304, and caller storage at 268,435,456 bytes. See the shipped [JSON Schema](https://github.com/dragoscirjan/neottia/blob/main/packages/searchable-core/config.schema.json).

The current tool registry does not gate service execution on `enabled`. The embedder must decide whether to reject a disabled configuration before invocation.
