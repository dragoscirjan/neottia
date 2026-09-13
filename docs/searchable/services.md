# Searchable library

`@neottia/searchable-core` exports the concrete runtime and the interfaces used for custom integrations.

```ts
import { createSearchableRuntime, findSearchableTool } from "@neottia/searchable-core";

const cwd = process.cwd();
const runtime = createSearchableRuntime({ cwd });
const search = findSearchableTool("web_search");
if (!search) throw new Error("web_search is not registered");

const result = await search.run({ cwd, services: runtime }, { query: "Neottia" });
console.log(result);
await runtime.close();
```

`createSearchableRuntime` implements `SearchableServices`. It owns the HTTP transport and `SearchableStore` for one working directory. Call `close()` during host shutdown. Closing is idempotent and rejects later work.

Applications may inject their own `SearchableServices`, `SearchableHttpTransport`, or DNS resolver. The shared registry validates inputs and outputs around those implementations. A custom HTTP transport must implement `stream()` to support `web_ask`; Searchable does not fall back to a buffered Ollama response. The checked mock shows every service without network access:

<<< ../examples/searchable-mock.ts

Injected transports must preserve cancellation, deadlines, response byte limits, credential handling, and destination policy. Do not use a test transport to weaken production `web_fetch` controls.
