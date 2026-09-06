# @neottia/memory-core

Standalone agent memory for Neottia: filesystem-canonical YAML records with a SQLite FTS5 (BM25) index. A Postgres backend behind the same interface is planned ([neottia#6](https://github.com/dragoscirjan/neottia/issues/6)); `backend: postgres` is rejected until it ships.

Part of the [Neottia](https://github.com/dragoscirjan/neottia) SDLC. See the [Sharded Module Configuration](https://github.com/dragoscirjan/neottia/wiki/Sharded-Module-Configuration) design for the configuration model.

## Features

- Typed memory records (`semantic`/`episodic`/`procedural` × `fact`/`decision`/`event`/`lesson`) with provenance, confidence, topics, and tags
- Lifecycle via supersession chains and tombstones — never destructive deletes
- Canonical YAML files on disk (git-diffable) + rebuildable SQLite index (BM25-ranked search)
- Shard-scoped locking, atomic batch writes with rollback, secret scanning, resource limits
- Module-owned config shard: `.neottia/config.yml` (`skills.memory`) with `NEOTTIA_MEMORY_*` env overrides — see the bindings table in `src/config.ts`

## Usage

```ts
import { MemoryStore, loadMemoryConfig } from "@neottia/memory-core";

const config = loadMemoryConfig(process.cwd(), { enabled: true });
const store = MemoryStore.fromConfig(config);

store.store({
  memory_type: "semantic",
  record_type: "fact",
  summary: "pnpm is the only package manager",
  source: { kind: "user-confirmed", ref: null, revision: null },
  created_by: "agent:pi",
  confidence: "confirmed",
});
```

`enabled` defaults to `false` — set `skills.memory.enabled: true` in `.neottia/config.yml` or `NEOTTIA_MEMORY_ENABLED=true`.

Requires Node.js >= 22.16.0 (the first line shipping SQLite with FTS5 enabled).

## License

MIT — see [LICENSE](./LICENSE).
