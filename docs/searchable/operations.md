# Searchable operations

## Back up and restore

Back up `.neottia/searchable/` with the rest of the repository's canonical Neottia data. Do not depend on `.neottia/cache/searchable.sqlite`; it is derived and excluded from authority.

Restore canonical files while Searchable is stopped. Remove the cache, restart the host, and let Searchable rebuild it. If canonical validation fails, repair or restore the reported JSON file rather than editing SQLite.

## Cache recovery

Stop all Searchable hosts before deleting `.neottia/cache/searchable.sqlite` and its sidecars. A later `web_grep` or `web_ask` rebuilds from canonical pages according to `stale_policy`. Concurrent hosts coordinate through Repository Store leases, but one long-lived runtime per CWD is the recommended topology.

## Rotation and diagnostics

Rotate provider credentials through their source environment variables and restart the host. Diagnostics should include only the stable error code and redacted message. Query strings, page content, prompts, keys, and provider response bodies may contain secrets.

## Failure triage

- `CAPABILITY_DISABLED`: set `modules.searchable.enabled: true` in the active CWD.
- `PROVIDER_CREDENTIAL_MISSING`: configure the selected API provider or use DuckDuckGo.
- `NETWORK_DESTINATION_BLOCKED`: choose a public HTTP(S) URL; local services are intentionally unreachable through fetch.
- `STASH_CACHE_REBUILD_REQUIRED`: permit a rebuild or switch policy to `rebuild`.
- Ollama connection errors: start Ollama and confirm the endpoint and model.
- `RESOURCE_LIMIT_EXCEEDED`: reduce the request or raise a reviewed limit.

Call runtime `close()` on server, plugin, or session shutdown. A closed runtime does not accept new operations.
