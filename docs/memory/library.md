# Memory library

Install the public package:

```sh
pnpm add @neottia/memory-core
```

Load project configuration and create a store:

```ts
import { MemoryStore, loadMemoryConfig } from "@neottia/memory-core";

const cwd = process.cwd();
const config = loadMemoryConfig(cwd, { enabled: true });
const store = MemoryStore.fromConfig(config, cwd);
try {
  const report = await store.validate();
  console.log(report.valid); // true in a clean project
} finally {
  await store.close();
}
```

The package exports `MemoryStore`, `FilesystemBackend`, `PostgresBackend`, the `StorageBackend` interface, storage state and limits, configuration and record schemas, ULID helpers, secret scanning helpers, JSON Schema conversion, operation report types, errors, and `MEMORY_TOOLS` with `findMemoryTool`.

## Backend constructors

Construct `FilesystemBackend` or `PostgresBackend` with `{config: MemoryConfig, cwd: string, onStaleCache?: () => boolean | Promise<boolean>}`. Filesystem also exposes `memoryRoot` and `namespaceScope`. `resolvePgSettings(config)` returns the resolved host, port, database, SSL, user, and password settings used by PostgreSQL.

A `StorageBackend` implements these asynchronous operations:

| Method                                               | Contract                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `loadState()`                                        | Return records, tombstones, active IDs, and the deterministic content hash.                                 |
| `applyBatch(replacements)`                           | Publish path replacements atomically; omitted bytes remove a path and `exclusive` rejects an existing path. |
| `search(state, query, options)`                      | Return ranked records within limit, character, topic, type, supersession, and active-ID bounds.             |
| `withLock(operation)`                                | Serialize the operation for the backend namespace.                                                          |
| `checkOrRebuildCache(state)`                         | Return checked or rebuilt cache evidence.                                                                   |
| `resetCache()`                                       | Dispose the current search projection.                                                                      |
| `close()`                                            | Release connections, handles, and watchers.                                                                 |
| `makeRecord`, `makeTombstone`, `validateCompactness` | Apply the shared creation and compactness rules.                                                            |
| `validateRecord`, `validateTombstone`                | Validate imported values against namespace and security policy.                                             |
| `recordPath`, `tombstonePath`, `encode`              | Map valid records to backend paths and canonical bytes.                                                     |

This complete wrapper adds publication auditing while delegating every storage contract to a shipped backend:

```ts
import type { StorageBackend } from "@neottia/memory-core";

export function withPublicationAudit(delegate: StorageBackend): StorageBackend {
  // Proxy delegation preserves method receivers for the concrete backend.
  return new Proxy(delegate, {
    get(target, property, receiver) {
      if (property === "applyBatch") {
        return async (replacements: Parameters<StorageBackend["applyBatch"]>[0]) => {
          console.log(`Publishing ${replacements.length} memory paths`);
          await target.applyBatch(replacements);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
```

The application owns a custom backend's durability, locking, namespace, security, and cleanup rules. Always call `close()` when a store or backend can retain a SQLite handle or PostgreSQL pool.
