# Migrate a legacy Searchable stash

The library importer moves rows from the legacy `.web_stash.db` `pages` table into canonical Neottia JSON records. It never makes the legacy SQLite file authoritative.

Stop the old MCP process first. Place the database directly in the selected project root. The importer rejects nested paths, active `-wal` or `-shm` sidecars, symlinks, and multiply linked files. Preview is the default:

```ts
import { createSearchableRuntime, importLegacySearchableDatabase } from "@neottia/searchable-core";

const runtime = createSearchableRuntime({ cwd: process.cwd() });
const preview = await importLegacySearchableDatabase(runtime.store, {
  path: ".web_stash.db",
});
console.log(preview);

const applied = await importLegacySearchableDatabase(runtime.store, {
  path: ".web_stash.db",
  preview: false,
});
console.log(applied);
await runtime.close();
```

Before reading rows, the importer opens one no-follow descriptor, copies it to a private snapshot in bounded chunks, and verifies that neither the descriptor nor project path changed. Restricting the source to a direct child prevents ancestor symlinks from redirecting the open outside the project. A worker opens the copy read-only, runs `PRAGMA integrity_check`, validates the `pages` shape, and iterates rows. The importer waits for worker termination before it removes the snapshot or returns. Source bytes, row count, and imported UTF-8 bytes are capped. Pass an `AbortSignal` or absolute `deadline` to stop snapshot and worker work. The importer converts the epoch deadline once and uses a monotonic timer for later stages.

Duplicate URLs use the same deterministic canonical identity. The report gives the planned and imported counts plus bounded conflict, warning, and error arrays. The source database is never changed or deleted. Keep it until you have inspected canonical files and confirmed `web_grep` results, then archive or remove it yourself.
