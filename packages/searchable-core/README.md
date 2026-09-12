# `@neottia/searchable-core`

`@neottia/searchable-core` is the host-neutral foundation for Neottia's Searchable web tools. It publishes strict runtime and JSON Schema contracts, a versioned configuration loader, structured errors, redaction helpers, service interfaces, and one executable registry for caller-owned services.

```sh
pnpm add @neottia/searchable-core
```

Read the [Searchable foundation guide](https://github.com/dragoscirjan/neottia/blob/main/docs/searchable/index.md) and [service implementation guide](https://github.com/dragoscirjan/neottia/blob/main/docs/searchable/services.md).

## Foundation status

This package **does not perform network, storage, extraction, or model operations by itself**. Every tool requires caller-injected `SearchableServices`. Provider clients, direct/Jina/Wayback extraction, canonical filesystem or SQLite storage and cache migration, Ollama integration, MCP delivery, and Pi/OpenCode extensions are intentionally deferred. Applications must not present these tools as operational until they inject working services. The current registry passes the resolved `enabled` value to services but does not reject calls when it is false, so the embedding application owns that gate.

## Tools

The registry exports exactly these names:

| Tool         | Input defaults                                                 | Typed object output                                    |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------ |
| `web_search` | `provider: duckduckgo`, `limit: 5`                             | `{ results: [{ title, url, snippet, siteName? }] }`    |
| `web_fetch`  | HTTP(S) `url`                                                  | `{ title, content, url, excerpt?, siteName?, source }` |
| `web_stash`  | HTTP(S) `url`, `title`, `content`, optional extracted metadata | `{ stashed: true, url }`                               |
| `web_grep`   | `limit: 5`                                                     | `{ results: [{ url, title, snippet, rank }] }`         |
| `web_ask`    | `limit: 3`                                                     | `{ answer, contextUrls }`                              |

All inputs are strict. Omitted provider and limit fields resolve from the loaded configuration; an explicit tool argument overrides the configured value. The table shows the default configuration values. In particular, `web_grep` rejects `provider`; the field appeared accidentally in an upstream runtime schema but was never part of the documented tool.

Outputs use object roots so a future MCP adapter can return structured content. That adapter can also render the upstream-compatible text representation without changing the core result.

## Inject services

```ts
import { findSearchableTool, type SearchableServices } from "@neottia/searchable-core";

const services: SearchableServices = {
  search: async (input, operation) => {
    // A real implementation must honor operation.signal and operation.config.
    return { results: await provider.search(input, operation) };
  },
  fetch: async (input, operation) => fetcher.fetch(input, operation),
  stash: async (input, operation) => storage.stash(input, operation),
  grep: async (input, operation) => storage.grep(input, operation),
  ask: async (input, operation) => asker.ask(input, operation),
};

const search = findSearchableTool("web_search");
await search?.run(
  { cwd: process.cwd(), services, signal: AbortSignal.timeout(20_000) },
  { query: "Neottia documentation" },
);
```

Services are owned by the caller. The registry does not construct, cache, close, or share them. Each method receives the invocation CWD, fully resolved config, and host cancellation signal.

Every registry call validates input, enforces configured UTF-8 byte and result bounds, invokes one service, validates the service output, enforces output bounds, and redacts errors. Service exceptions never retain a raw `cause` across this boundary.

## Configuration

The loader reads `.neottia/config.yml` and owns the `skills.searchable` shard. The YAML root must contain `version: 1`. Every leaf resolves with this precedence:

1. explicit `loadSearchableConfig()` override;
2. environment variable;
3. YAML shard value;
4. schema default.

```yaml
version: 1
skills:
  searchable:
    enabled: true
    root: .neottia/searchable
    search:
      provider: google
      limit: 5
      credentials:
        google_api_key: ${GOOGLE_API_KEY}
        google_cse_id: ${GOOGLE_CSE_ID}
    fetch:
      strategies: [direct, jina, wayback]
      timeout_ms: 10000
      overall_timeout_ms: 20000
    grep:
      limit: 5
    ask:
      limit: 3
    ollama:
      endpoint: http://localhost:11434
      model: llama3
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

YAML credentials must be exact `${ENV_VAR}` references. Literal credentials are accepted only as trusted programmatic overrides or environment values. The generated `config.schema.json` is exported as `@neottia/searchable-core/config.schema.json` for editor and validation integration.

### Configuration reference

Structural environment variables are resolved separately from shard leaves:

- `NEOTTIA_CONFIG_FILE`, then `NEOTTIA_SEARCHABLE_CONFIG_FILE`, selects the file relative to the invocation CWD.
- `NEOTTIA_CONFIG_SEARCHABLE_PATH` selects the shard dot-path; its default is `skills.searchable`.

Every shard path and supported environment binding is listed below. `—` means that the value is configured through YAML or an explicit library override only. Canonical names always outrank legacy aliases.

| Config path                         | Default                                      | Canonical environment variable                                 | Legacy alias         |
| ----------------------------------- | -------------------------------------------- | -------------------------------------------------------------- | -------------------- |
| `enabled`                           | `false`                                      | `NEOTTIA_SEARCHABLE_ENABLED`                                   | —                    |
| `root`                              | `.neottia/searchable`                        | `NEOTTIA_SEARCHABLE_ROOT`                                      | —                    |
| `search.provider`                   | `duckduckgo`                                 | `NEOTTIA_SEARCHABLE_PROVIDER`                                  | —                    |
| `search.limit`                      | `5`                                          | `NEOTTIA_SEARCHABLE_SEARCH_LIMIT`                              | —                    |
| `search.credentials.google_api_key` | unset                                        | `NEOTTIA_SEARCHABLE_GOOGLE_API_KEY`                            | `GOOGLE_API_KEY`     |
| `search.credentials.google_cse_id`  | unset                                        | `NEOTTIA_SEARCHABLE_GOOGLE_CSE_ID`                             | `GOOGLE_CSE_ID`      |
| `search.credentials.bing_api_key`   | unset                                        | `NEOTTIA_SEARCHABLE_BING_API_KEY`                              | `BING_API_KEY`       |
| `search.credentials.brave_api_key`  | unset                                        | `NEOTTIA_SEARCHABLE_BRAVE_API_KEY`                             | `BRAVE_API_KEY`      |
| `search.bing_api_endpoint`          | `https://api.bing.microsoft.com/v7.0/search` | `NEOTTIA_SEARCHABLE_BING_API_ENDPOINT`                         | `BING_API_ENDPOINT`  |
| `fetch.strategies`                  | `[direct, jina, wayback]`                    | `NEOTTIA_SEARCHABLE_FETCH_FALLBACK` maps `false` to `[direct]` | `WEB_FETCH_FALLBACK` |
| `fetch.timeout_ms`                  | `10000`                                      | —                                                              | —                    |
| `fetch.overall_timeout_ms`          | `20000`                                      | —                                                              | —                    |
| `fetch.max_response_bytes`          | `10485760`                                   | —                                                              | —                    |
| `grep.limit`                        | `5`                                          | `NEOTTIA_SEARCHABLE_GREP_LIMIT`                                | —                    |
| `grep.snippet_bytes`                | `512`                                        | —                                                              | —                    |
| `ask.limit`                         | `3`                                          | `NEOTTIA_SEARCHABLE_ASK_LIMIT`                                 | —                    |
| `ask.context_bytes`                 | `131072`                                     | —                                                              | —                    |
| `ollama.endpoint`                   | `http://localhost:11434`                     | `NEOTTIA_SEARCHABLE_OLLAMA_URL`                                | `OLLAMA_URL`         |
| `ollama.model`                      | `llama3`                                     | `NEOTTIA_SEARCHABLE_OLLAMA_MODEL`                              | `OLLAMA_MODEL`       |
| `ollama.timeout_ms`                 | `60000`                                      | —                                                              | —                    |
| `cache.max_age_ms`                  | `300000`                                     | —                                                              | —                    |
| `cache.stale_policy`                | `prompt`                                     | —                                                              | —                    |
| `security.limits.max_query_bytes`   | `16384`                                      | —                                                              | —                    |
| `security.limits.max_url_bytes`     | `8192`                                       | —                                                              | —                    |
| `security.limits.max_title_bytes`   | `4096`                                       | —                                                              | —                    |
| `security.limits.max_content_bytes` | `10485760`                                   | —                                                              | —                    |
| `security.limits.max_results`       | `100`                                        | —                                                              | —                    |
| `security.limits.max_result_bytes`  | `4194304`                                    | —                                                              | —                    |
| `security.limits.max_storage_bytes` | `268435456`                                  | —                                                              | —                    |

`NEOTTIA_SEARCHABLE_FETCH_FALLBACK=false` and its legacy alias select direct fetch only. Any true value restores the default direct, then Jina, then Wayback order.

## Safety limits and diagnostics

Static schemas cap result counts at 100, queries at 16 KiB, URLs at 8 KiB, titles at 4 KiB, content at 10 MiB, serialized output at 4 MiB, and future canonical storage at 256 MiB. Configured limits may be tighter and are measured as UTF-8 bytes around service execution. Concrete services remain responsible for enforcing request deadlines, response streaming limits, storage quotas, and private-network policy.

`SearchableError` provides stable `category`, `code`, `message`, `paths`, and optional `details`. Unknown service failures are mapped to `SERVICE_FAILED`. Diagnostics strip URL userinfo, query strings, fragments, and every resolved provider credential. Callers should still avoid placing sensitive page content in custom service error messages.

## Deferred implementation work

This foundation deliberately does not choose or ship:

- DuckDuckGo, Google, Bing, or Brave HTTP provider implementations;
- direct HTML extraction or Jina and Wayback fallback clients;
- canonical filesystem format, SQLite schema/cache, migrations, or cache rebuild behavior;
- Ollama request and context assembly implementation;
- MCP server or legacy text rendering;
- Pi or OpenCode delivery extensions.

Those layers should consume `searchableToolSchemas` and `SEARCHABLE_TOOLS` unchanged rather than duplicating names, validation, defaults, or execution behavior.
