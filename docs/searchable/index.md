# Searchable

Searchable gives AI tools a bounded web research workflow. It searches configured providers, extracts web pages, stores selected content as canonical repository files, searches the local stash with SQLite FTS5, and asks Ollama questions grounded in stashed pages.

Choose one delivery method:

- `@neottia/searchable-mcp` for any MCP client
- `@neottia/pi-searchable` for native Pi tools
- `@neottia/opencode-searchable` for native OpenCode tools
- `@neottia/searchable-core` for direct TypeScript use

All methods expose `web_search`, `web_fetch`, `web_stash`, `web_grep`, and `web_ask` from the same registry.

## First result

Enable Searchable:

```yaml
version: 1
skills:
  searchable:
    enabled: true
```

DuckDuckGo is the default provider and needs no key. Start an MCP server from the project directory:

```sh
pnpm dlx @neottia/searchable-mcp
```

Call `web_search` with `{"query":"Neottia documentation"}`. Fetch a useful result with `web_fetch`, then pass its URL, title, content, and optional metadata to `web_stash`. The canonical record appears below `.neottia/searchable/pages/`.

Continue with [providers](/searchable/providers), [fetching](/searchable/fetching), [stash and grep](/searchable/stash-and-search), or [grounded answers](/searchable/asking).
