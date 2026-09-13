# Fetch and extraction

`web_fetch` tries `fetch.strategies` in order. The default order is `direct`, `jina`, then `wayback`.

Direct fetch accepts HTML and XHTML. Mozilla Readability extracts the article, and Turndown converts it to Markdown with ATX headings and fenced code blocks. Empty extraction, unsupported content types, oversized decoded bodies, and oversized Markdown fail.

Jina Reader returns Markdown from its fixed HTTPS origin. Wayback first checks the fixed availability API, then accepts only an HTTPS snapshot URL on `web.archive.org`. Searchable does not disclose target URLs containing credentials or query strings to either third party. In that case it skips remote fallback and reports a bounded strategy code.

`fetch.timeout_ms` limits each attempt. `fetch.overall_timeout_ms` limits the complete strategy sequence. The returned `source` is `direct`, `jina`, or `wayback`, while `url` remains the original target. Cancellation stops the current request and prevents the next strategy.
