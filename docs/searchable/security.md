# Searchable security

Searchable treats tool input, remote responses, canonical files, disposable caches, and model context as untrusted.

The default HTTP client accepts HTTP and HTTPS targets without user information. Before connecting, it resolves every address and rejects the request if any answer is local, private, link-local, metadata, multicast, reserved, or otherwise non-public. It pins an accepted answer for the connection. Redirects receive the same checks; HTTPS downgrade, loops, and excessive hops fail. Cross-origin redirects lose sensitive headers.

The client counts decoded response bytes and destroys an oversized stream. Ollama responses use incremental newline-delimited JSON parsing with separate frame and answer bounds. One overall fetch deadline covers the configured strategy sequence, and each attempt uses the smaller per-strategy deadline. The runtime converts public epoch deadlines once and uses monotonic timers for network, storage, cache, and migration work. Cancellation stops network reads and prevents later publication.

Jina and Wayback receive the requested URL only when it has no user information or query string. Wayback snapshot URLs must use the expected HTTPS archive host. Ollama is a narrow trusted-local exception used only by `web_ask`; `web_fetch` cannot use it to reach local services.

Canonical stash files are repository authority. Repository Store rejects symlinks, hard links, special files, unsafe paths, concurrent replacements, and quota violations. SQLite contains only a derived FTS projection. Its separate disk limit allows eight times the canonical quota plus 8 MiB for SQLite and rebuild overhead. Grep reloads matching canonical files and builds returned snippets from those files.

Ask prompts mark page content as untrusted quoted data and cap the complete prompt in UTF-8 bytes. This framing does not make remote text or model answers trustworthy. Verify important claims against their returned source URLs.

Error redaction removes resolved provider credentials and URL queries from diagnostic text. Do not log prompts, page bodies, request headers, transport objects, or upstream response bodies.
