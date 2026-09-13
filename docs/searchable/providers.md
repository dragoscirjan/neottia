# Search providers

`web_search` supports four providers.

| Provider             | Configuration                                    |     Request cap |
| -------------------- | ------------------------------------------------ | --------------: |
| DuckDuckGo           | none                                             | requested limit |
| Google Custom Search | `google_api_key` and `google_cse_id`             |              10 |
| Bing                 | `bing_api_key`; optional HTTPS endpoint override |              50 |
| Brave                | `brave_api_key`                                  |              20 |

DuckDuckGo is the zero-configuration default. The runtime decodes DuckDuckGo `uddg` result links. API providers map their JSON responses into the same title, URL, snippet, and optional site-name shape.

`search.timeout_ms` bounds DNS, connection, headers, and body reads for one provider request. Missing credentials fail before a request. Authentication errors, rate limits, malformed payloads, oversized responses, deadlines, and upstream failures use stable bounded error codes. Provider keys come from the resolved Searchable configuration; providers do not read environment variables directly.
