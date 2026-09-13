# Searchable tools

Every delivery method uses these five names and contracts.

| Tool         | Exact resolved input                                                                                | Exact output                                         |
| ------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `web_search` | nonblank `query` up to 16 KiB, `provider`, `limit` 1-100                                            | `{results: [{title, url, snippet, siteName?}]}`      |
| `web_fetch`  | HTTP or HTTPS `url` up to 8 KiB                                                                     | `{title, content, url, excerpt?, siteName?, source}` |
| `web_stash`  | URL, nonblank title up to 4 KiB, nonblank content up to 10 MiB; optional excerpt, site name, source | `{stashed: true, url}`                               |
| `web_grep`   | nonblank `query` up to 16 KiB, `limit` 1-100                                                        | `{results: [{url, title, snippet, rank}]}`           |
| `web_ask`    | nonblank `question` up to 16 KiB, `limit` 1-100                                                     | `{answer, contextUrls}`                              |

Search provider, search limit, grep limit, and ask limit resolve from configuration when omitted. Unknown fields fail strict input validation. The registry validates service output and configured UTF-8 and aggregate limits before returning it.

Errors contain `category`, stable `code`, `message`, `paths`, and optional bounded `details`. They do not contain `retryable`. Common codes include `CAPABILITY_DISABLED`, `NETWORK_DESTINATION_BLOCKED`, `REDIRECT_BLOCKED`, `RESPONSE_TOO_LARGE`, `DEADLINE_EXCEEDED`, `PROVIDER_CREDENTIAL_MISSING`, `STASH_CACHE_REBUILD_REQUIRED`, and `OLLAMA_RESPONSE_INVALID`.
