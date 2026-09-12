# Searchable foundation tools

> Searchable is foundation-only. Each tool calls a service supplied by your application.

| Tool         | Exact resolved input                                                                                | Exact output                                         |
| ------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `web_search` | nonblank `query` up to 16 KiB, `provider`, `limit` 1-100                                            | `{results: [{title, url, snippet, siteName?}]}`      |
| `web_fetch`  | HTTP or HTTPS `url` up to 8 KiB                                                                     | `{title, content, url, excerpt?, siteName?, source}` |
| `web_stash`  | URL, nonblank title up to 4 KiB, nonblank content up to 10 MiB; optional excerpt, site name, source | `{stashed: true, url}`                               |
| `web_grep`   | nonblank `query` up to 16 KiB, `limit` 1-100                                                        | `{results: [{url, title, snippet, rank}]}`           |
| `web_ask`    | nonblank `question` up to 16 KiB, `limit` 1-100                                                     | `{answer, contextUrls}`                              |

Search results use HTTP or HTTPS URLs and optional nonblank site names. Fetch source is `direct | jina | wayback`. Grep rank is a finite number. Ask returns at most 100 context URLs. Content, excerpt, snippet, and answer fields remain subject to configured UTF-8 and aggregate result limits.

Omitted search, grep, and ask limits resolve from configuration before the service call. Search provider also resolves from configuration. Inputs and service outputs pass strict Zod validation. Unknown keys and non-HTTP URLs fail.

Call a definition with `findSearchableTool(name).run({cwd, services, signal?, configOverrides?}, input)` after checking that the lookup returned a definition. The service context receives CWD, fully resolved config, and optional abort signal. Errors contain `category`, `code`, `message`, `paths`, and optional `details`. They do not contain `retryable`. See the [complete injected example](/searchable/services).
