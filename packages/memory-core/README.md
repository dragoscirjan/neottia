# @neottia/memory-core

Typed Memory library with filesystem-canonical YAML or PostgreSQL storage.

## Requirements and installation

Filesystem Memory requires Node.js 22.16 or newer on a supported Linux local filesystem. PostgreSQL Memory requires Node.js 22.16 or newer and deployment-owned credentials and scope. See the [requirements guide](https://github.com/dragoscirjan/neottia/blob/main/docs/get-started/requirements.md).

```sh
pnpm add @neottia/memory-core
```

## Quick start

This example enables Memory with an explicit override, stores a fact, supersedes it, deletes the replacement with a tombstone, and closes the backend:

```ts
import { MemoryStore, loadMemoryConfig } from "@neottia/memory-core";

const cwd = process.cwd();
const config = loadMemoryConfig(cwd, {
  enabled: true,
  namespace: { organization_id: "acme", project_id: "website" },
});
const store = MemoryStore.fromConfig(config, cwd);
try {
  const fact = {
    memory_type: "semantic" as const,
    record_type: "fact" as const,
    summary: "The site is deployed with pnpm, never npm",
    details: null,
    topic: "tooling",
    source: { kind: "user-confirmed" as const, ref: null, revision: null },
    created_by: "agent:pi",
    confidence: "confirmed" as const,
    tags: ["packaging"],
  };
  const record = await store.store(fact);
  const replacement = await store.supersede(record.id, {
    ...fact,
    summary: "The site is deployed with pnpm; npm is blocked via packageManager",
  });
  await store.delete(replacement.id, "No longer applicable", replacement.source, "agent:pi");
} finally {
  await store.close();
}
```

The filesystem result is canonical YAML below `.neottia/memory/`. Its `index.db`, WAL, and SHM files are disposable.

## Configuration and public API

```ts
export type LoadMemoryConfigOptions = Partial<MemoryConfigInput> & {
  env?: NodeJS.ProcessEnv;
};

export function loadMemoryConfig(cwd: string, options?: LoadMemoryConfigOptions): MemoryConfig;
```

Memory contributes the canonical `modules.memory` shard to `@neottia/config`. The shared resolver applies defaults, global and project files, the selected profile, environment bindings, and explicit overrides in that order. `loadMemoryConfig` keeps the deprecated `skills.memory` path and historical file selectors for standalone compatibility. Environment variables override only the leaves listed in the [configuration reference](https://github.com/dragoscirjan/neottia/blob/main/docs/memory/configuration.md). `security.secret_patterns` and every `security.limits` leaf remain file/code-only.

The package exports `memoryConfigContribution`, `MemoryStore`, `FilesystemBackend`, `PostgresBackend`, `StorageBackend`, configuration and record schemas, errors, security helpers, ULID helpers, report types, and the nine-tool registry. Hosts can resolve one shared snapshot and pass `snapshot.get(memoryConfigContribution)` to `MemoryStore.fromConfig`. Read the [unified configuration guide](https://github.com/dragoscirjan/neottia/blob/main/docs/configuration.md), [library and backend API](https://github.com/dragoscirjan/neottia/blob/main/docs/memory/library.md), [tool contracts](https://github.com/dragoscirjan/neottia/blob/main/docs/memory/tools.md), [record lifecycle](https://github.com/dragoscirjan/neottia/blob/main/docs/memory/records.md), [backend guide](https://github.com/dragoscirjan/neottia/blob/main/docs/memory/backends.md), and [operations guide](https://github.com/dragoscirjan/neottia/blob/main/docs/memory/operations.md).

## Scope

The filesystem backend ignores `namespace.scope`. Separate worktrees stay isolated through separate configured roots. Namespace scope separates PostgreSQL rows within one organization and project. Filesystem and PostgreSQL authorities require an explicit export, preview, and import migration.

## License

MIT. See [LICENSE](./LICENSE).
