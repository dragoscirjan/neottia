# @neottia/searchable-core

Search, fetch, stash, grep, and ask services for repository-local web research. The package provides the shared five-tool registry and a concrete runtime used by the MCP, Pi, and OpenCode packages.

## Install

```sh
pnpm add @neottia/searchable-core
```

Node.js 22.16 or newer is required. Canonical stash files and the SQLite FTS cache require a filesystem supported by `@neottia/repository-store`.

## Configure

Create `.neottia/config.yml` in the project working directory:

```yaml
version: 1
skills:
  searchable:
    enabled: true
    search:
      provider: duckduckgo
```

DuckDuckGo requires no key. Google needs `google_api_key` and `google_cse_id`; Bing and Brave need their API keys. YAML credential values must use `${ENV_NAME}` references. See [`config.schema.json`](./config.schema.json) for the complete shard.

## Use the concrete runtime

```ts
import { createSearchableRuntime, findSearchableTool } from "@neottia/searchable-core";

const runtime = createSearchableRuntime({ cwd: process.cwd() });
const search = findSearchableTool("web_search");
if (!search) throw new Error("web_search is not registered");

const result = await search.run({ cwd: process.cwd(), services: runtime }, { query: "Neottia documentation" });
console.log(result);
await runtime.close();
```

The shared registry exposes `web_search`, `web_fetch`, `web_stash`, `web_grep`, and `web_ask`. Inputs and outputs pass the same Zod contracts for every delivery package.

## Runtime behavior

- Search supports DuckDuckGo, Google Custom Search, Bing, and Brave.
- Fetch tries the configured `direct`, `jina`, and `wayback` strategies in order. Direct fetch blocks private and special-use destinations, validates redirects, and bounds decoded response bytes.
- Stash writes canonical JSON records below `.neottia/searchable/pages/`. `.neottia/cache/searchable.sqlite` is a disposable FTS5 index with a separate limit of eight times the canonical quota plus 8 MiB.
- Grep treats query text as bounded literal terms. It reloads canonical records before returning titles, URLs, and snippets.
- Ask selects canonical stash context and calls the configured Ollama `/api/generate` endpoint. It parses newline-delimited JSON incrementally, bounds frames and the cumulative answer, and returns the source URLs.
- `skills.searchable.enabled` must resolve to `true` before any service runs.

Call `close()` when the host shuts down. Closing aborts new work and closes the injected transport.

## Legacy migration

`importLegacySearchableDatabase(store, {path: ".web_stash.db"})` previews by default. The source must be a direct child of the project root. Stop the legacy server and remove active WAL or SHM sidecars first. Set `preview: false` only after checking the report. The importer snapshots the database, checks integrity, reads only the `pages` table, waits for its worker to terminate, and leaves the source file unchanged.

## Security boundary

`web_fetch` accepts only HTTP and HTTPS URLs without user information. The default client rejects local, private, link-local, metadata, multicast, reserved, and mixed public/private DNS destinations. It pins the accepted address for the request and revalidates redirects. Jina and Wayback do not receive target URLs that contain query parameters.

Ollama is the only trusted-local network exception. That exception is confined to the model client and does not change `web_fetch` policy. Treat fetched text and model answers as untrusted input.

Errors use `{category, code, message, paths, details?}`. Diagnostics remove credential values and URL query strings. Provider response bodies and request objects are not included.

Full user documentation is at [`docs/searchable/`](../../docs/searchable/index.md).
