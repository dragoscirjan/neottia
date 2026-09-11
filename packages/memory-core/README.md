# @neottia/memory-core

Standalone, typed agent memory: **filesystem-canonical YAML records** with a **SQLite FTS5 (BM25) index**, designed to be consumed as a plain library, embedded in AI harness extensions, or exposed over MCP.

A memory module stores what an AI agent (or team of agents) learns while working on a project — facts, decisions, events, and lessons — as small, reviewable YAML files that live **inside the project repository** and can be committed, diffed, and audited like code. A disposable SQLite index sits next to the files and provides ranked full-text search; it can be deleted and rebuilt at any time without losing anything. Filesystem mode uses `@neottia/repository-store` for the repository-wide lease, exact byte revisions, durable rollback recovery, and safe publication while memory-core retains the YAML schema and search policy.

Part of the [Neottia](https://github.com/dragoscirjan/neottia) SDLC. The configuration model follows the [Sharded Module Configuration](https://github.com/dragoscirjan/neottia/wiki/Sharded-Module-Configuration) design.

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Concepts](#concepts)
  - [Memory records](#memory-records)
  - [Lifecycle: supersession and tombstones](#lifecycle-supersession-and-tombstones)
  - [Namespaces and shards](#namespaces-and-shards)
  - [Canonical files and the index cache](#canonical-files-and-the-index-cache)
- [Configuration](#configuration)
  - [Where configuration is read from](#where-configuration-is-read-from)
  - [Resolution order](#resolution-order)
  - [Config file example](#config-file-example)
  - [Environment variable reference](#environment-variable-reference)
  - [Credentials](#credentials)
- [API](#api)
  - [`loadMemoryConfig`](#loadmemoryconfig)
  - [`MemoryStore`](#memorystore)
  - [Operation reference](#operation-reference)
- [Search semantics](#search-semantics)
- [The memory tool contract](#the-memory-tool-contract)
- [Error handling](#error-handling)
- [Security](#security)
- [Concurrency](#concurrency)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Requirements

- **Node.js >= 22.16.0** or **Bun >= 1.3.13** with built-in SQLite and FTS5.
- Linux x64 or arm64, the repository-store Node-API addon (built with a C++17 compiler, Python, Make, and Linux development headers), and kernel/libc support for `renameat2(..., RENAME_NOREPLACE)`.
- A writable project directory on a recognized local ext4, XFS, Btrfs, tmpfs, or overlay filesystem with same-volume regular-file hard links. Filesystem Memory cannot acquire repository authority on macOS, Windows, shared/network filesystems, or when the native addon is missing or unloadable.

## Installation

```bash
pnpm add @neottia/memory-core
# Install with pnpm; this project standardizes on pnpm.
```

## Quick start

```ts
import { MemoryStore, loadMemoryConfig } from "@neottia/memory-core";

// 1. Resolve configuration (file shard + env vars + defaults; see Configuration).
//    Passing overrides in code always wins and needs no config file at all.
const config = loadMemoryConfig(process.cwd(), {
  enabled: true,
  namespace: { organization_id: "acme", project_id: "website" },
});

// 2. Create a store scoped to the working directory.
const store = MemoryStore.fromConfig(config, process.cwd());

// 3. Remember something.
const record = await store.store({
  memory_type: "semantic", // what kind of knowledge
  record_type: "fact", // must pair with memory_type (see below)
  summary: "The site is deployed with pnpm, never npm",
  details: null,
  topic: "tooling",
  source: { kind: "user-confirmed", ref: null, revision: null },
  created_by: "agent:pi",
  confidence: "confirmed",
  tags: ["packaging"],
});

// 4. Retrieve it.
await store.get(record.id); // by ULID
await store.list({ topic: "tooling" }); // newest first
await store.search({ query: "deploy packaging" }); // BM25-ranked

// 5. Correct it later (the old record stays, referenced and inactive).
await store.supersede(record.id, {
  ...fact,
  summary: "The site is deployed with pnpm; npm is blocked via packageManager",
});

// 6. Or retire it entirely (a tombstone is written; nothing is deleted).
await store.delete(record.id, "No longer applicable", record.source, "agent:pi");
```

Without any configuration file this works because the overrides above enable it. Without overrides, memory is **disabled by default** — see [Configuration](#configuration).

## Concepts

### Memory records

Every memory is a single YAML file with a Crockford ULID identity and a rich classification. Two taxonomies must pair correctly:

| `memory_type` | Allowed `record_type` | Typical use                                |
| ------------- | --------------------- | ------------------------------------------ |
| `semantic`    | `fact`                | Stable knowledge ("the project uses pnpm") |
| `episodic`    | `decision`, `event`   | Something that happened or was decided     |
| `procedural`  | `lesson`              | How to do something / what to avoid        |

Other fields:

| Field        | Meaning                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `summary`    | Required, ≤ 240 Unicode characters on write (canonical files may hold up to 1000 for legacy imports)                        |
| `details`    | Optional, ≤ 2000 Unicode characters and ≤ 12 non-empty lines on write                                                       |
| `source`     | Provenance: `kind` is `artifact`, `user-confirmed`, `discussion`, or `tool-observation`, plus optional `ref` and `revision` |
| `confidence` | `confirmed` or `verified`; **`verified` requires the source `kind` to be `artifact` or `tool-observation`**                 |
| `topic`      | Free-form grouping; defaults to `namespace.default_topic`                                                                   |
| `tags`       | Sorted, unique string list                                                                                                  |
| `supersedes` | IDs of records this record replaces                                                                                         |

### Lifecycle: supersession and tombstones

Memory is append-only. Two mechanisms retire records, and both preserve history:

- **Supersede** — write a new record whose `supersedes` array references the old one. The old record becomes _inactive_ (hidden from `list`/`search` by default) but remains on disk. Supersession graphs are checked for cycles and broken references.
- **Delete (tombstone)** — write a tombstone file referencing the target with a reason and who deleted it. Canonical files are **never deleted**.

A record is _active_ when nothing supersedes it and no tombstone targets it. Pass `include_superseded: true` to read inactive records too.

### Namespaces and shards

Every record carries `organization_id` and `project_id` from configuration. Writes whose namespace does not match the configured one are rejected. A third, optional dimension — `namespace.scope` (for example a branch or workspace id, default `global`) — identifies the _shard_: the unit of locking and (in remote backends) of data separation. Each git worktree naturally has its own memory root, so different branches never collide on the filesystem.

### Canonical files and the index cache

```text
.neottia/memory/                  ← memory root (configurable)
├── facts/                        ← one YAML file per record, named <ULID>.yaml
│   └── 01J8Z0V1A2B3C4D5E6G7H8J9K0.yaml
├── decisions/
├── events/
├── lessons/
├── tombstones/
└── index.db                      ← SQLite cache: searchable, disposable
```

- The **YAML files are the truth**. The SQLite index (`index.db`, WAL mode, FTS5) is a rebuildable cache.
- The index is refreshed automatically when its content hash diverges from the canonical files or when it ages past `cache.max_age_ms`, subject to `cache.stale_policy`.
- A corrupt `index.db` is detected and rebuilt from the canonical files on the next operation.
- Deleting `index.db` is always safe.

An example record file:

```yaml
schema_version: 1
id: 01J8Z0V1A2B3C4D5E6G7H8J9K0
memory_type: semantic
record_type: fact
organization_id: acme
project_id: website
topic: tooling
summary: The site is deployed with pnpm, never npm
details: null
source:
  kind: user-confirmed
  ref: null
  revision: null
created_at: 2026-09-06T18:00:00.000Z
created_by: agent:pi
confidence: confirmed
status: active
supersedes: []
tags:
  - packaging
```

## Configuration

Memory follows Neottia's sharded configuration model: this module owns the `skills.memory` section of a shared config object, and every value can be overridden by an environment variable or by code.

### Where configuration is read from

| What        | Resolution                                                                         | Default                                                              |
| ----------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Config file | `NEOTTIA_CONFIG_FILE` → `NEOTTIA_MEMORY_CONFIG_FILE` → `<cwd>/.neottia/config.yml` | The project config file                                              |
| Shard path  | `NEOTTIA_CONFIG_MEMORY_PATH`                                                       | `skills.memory` (the section of the config object this module reads) |

The config file must declare `version: 1` at its root. Other modules' sections are ignored by this module. If the file or the shard is missing, defaults are used — the module works standalone with zero configuration.

### Resolution order

For every value:

```text
explicit argument in code  >  environment variable  >  config file  >  built-in default
```

### Config file example

```yaml
# .neottia/config.yml
version: 1
skills:
  memory:
    enabled: true
    root: .neottia/memory
    backend: filesystem # or postgres for a shared PostgreSQL memory store
    namespace:
      organization_id: acme
      project_id: website
      default_topic: general
      scope: global # e.g. a branch or workspace id
    retrieval:
      limit: 8 # default result count for list/search
      max_chars: 12000 # search result budget, in JSON characters
      include_superseded: false
    cache:
      max_age_ms: 300000 # index considered stale after 5 minutes
      stale_policy: prompt # prompt | rebuild | fail
    security:
      secret_patterns: [] # extra regexes treated as secrets
      entropy_heuristic: true # reject high-entropy strings (likely tokens)
      limits:
        max_file_bytes: 16777216 # 16 MiB per memory file
        max_files: 10000 # total memory files
        max_total_bytes: 268435456 # 256 MiB aggregate
```

### Environment variable reference

All environment variables are optional. Booleans accept `true/false/1/0`; integers accept plain digits; invalid forms fail with the variable name in the error.

| Variable                                      | Config path                               | Default               |
| --------------------------------------------- | ----------------------------------------- | --------------------- |
| `NEOTTIA_CONFIG_FILE`                         | _(file location)_                         | —                     |
| `NEOTTIA_MEMORY_CONFIG_FILE`                  | _(file location fallback)_                | `.neottia/config.yml` |
| `NEOTTIA_CONFIG_MEMORY_PATH`                  | _(shard path)_                            | `skills.memory`       |
| `NEOTTIA_MEMORY_ENABLED`                      | `memory.enabled`                          | `false`               |
| `NEOTTIA_MEMORY_ROOT`                         | `memory.root`                             | `.neottia/memory`     |
| `NEOTTIA_MEMORY_BACKEND`                      | `memory.backend`                          | `filesystem`          |
| `NEOTTIA_MEMORY_NAMESPACE_ORGANIZATION_ID`    | `memory.namespace.organization_id`        | `local`               |
| `NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID`         | `memory.namespace.project_id`             | `project`             |
| `NEOTTIA_MEMORY_NAMESPACE_DEFAULT_TOPIC`      | `memory.namespace.default_topic`          | `general`             |
| `NEOTTIA_MEMORY_NAMESPACE_SCOPE`              | `memory.namespace.scope`                  | `global`              |
| `NEOTTIA_MEMORY_RETRIEVAL_LIMIT`              | `memory.retrieval.limit`                  | `8`                   |
| `NEOTTIA_MEMORY_RETRIEVAL_MAX_CHARS`          | `memory.retrieval.max_chars`              | `12000`               |
| `NEOTTIA_MEMORY_RETRIEVAL_INCLUDE_SUPERSEDED` | `memory.retrieval.include_superseded`     | `false`               |
| `NEOTTIA_MEMORY_CACHE_MAX_AGE_MS`             | `memory.cache.max_age_ms`                 | `300000`              |
| `NEOTTIA_MEMORY_CACHE_STALE_POLICY`           | `memory.cache.stale_policy`               | `prompt`              |
| `NEOTTIA_MEMORY_SECURITY_ENTROPY_HEURISTIC`   | `memory.security.entropy_heuristic`       | `true`                |
| `NEOTTIA_MEMORY_DB_PG_USER`                   | `memory.provider.db.pg.user` fallback     | —                     |
| `NEOTTIA_MEMORY_DB_PG_PASSWORD`               | `memory.provider.db.pg.password` fallback | —                     |

Postgres connection settings (`NEOTTIA_MEMORY_DB_PG_HOST`, `..._PORT`, `..._DATABASE`, `..._SSL`) configure the PostgreSQL backend. The backend creates or migrates its scoped tables on first use; run the PostgreSQL integration checks against a disposable database before production rollout. Use `${NEOTTIA_MEMORY_DB_PG_USER}` and `${NEOTTIA_MEMORY_DB_PG_PASSWORD}` references (or the fallback environment variables) for YAML credentials. Literal credentials are rejected in YAML.

### Credentials

`provider.db.pg.user` and `provider.db.pg.password` in YAML must be omitted or use an exact `${ENV_VAR}` reference:

- omitted — then the default env vars above are used, or
- a reference: `user: "${PG_USER}"` — expanded once from the environment at load time; a missing variable fails with a named error.

Literal YAML credentials and strings containing anything besides the single reference are rejected. Library-only explicit overrides may pass an already-resolved literal.

## API

Everything below is exported from the package root. All names are stable public API unless marked otherwise.

### `loadMemoryConfig`

```ts
export function loadMemoryConfig(cwd: string, options: LoadMemoryConfigOptions | undefined): MemoryConfig;

export interface LoadMemoryConfigOptions {
  env?: NodeJS.ProcessEnv; // defaults to process.env; pass {} for hermetic tests
}
```

Resolves the effective configuration for `cwd`. Throws `ConfigError` with precise `validationPaths` when the file, the shard, or env values are invalid. Never creates directories.

### `MemoryStore`

```ts
export const store = MemoryStore.fromConfig(config, cwd);
// equivalent to:
export const store2 = new MemoryStore({
  config,
  cwd,
  onStaleCache, // () => boolean | Promise<boolean>; prompt-policy host hook
  now, // () => Date; injectable clock for tests
});
```

| Option         | Purpose                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`       | A resolved `MemoryConfig`                                                                                                                    |
| `cwd`          | Working directory; `config.root` resolves against it                                                                                         |
| `now`          | Injectable clock (tests)                                                                                                                     |
| `onStaleCache` | Host hook used when `stale_policy: prompt`: return `true` to rebuild, `false` to refuse. Absent ⇒ degrade to rebuild (non-interactive hosts) |

The store enforces `enabled: true` itself: with memory disabled, every operation throws a `MemoryError` naming `skills.memory.enabled=true`, while `validate()` and `import(..., true)` report the condition instead of throwing.

### Operation reference

| Operation   | Signature                                                                                                                 | Notes                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`     | `async store(input: StoreMemoryInput): Promise<MemoryRecord>`                                                             | Creates an active record; fails on duplicate identity, invalid type pairing, secrets, or compactness violations                                                                                                                              |
| `supersede` | `async supersede(targetId: string, input: StoreMemoryInput): Promise<MemoryRecord>`                                       | Target must be active; new record references it via `supersedes`                                                                                                                                                                             |
| `delete`    | `async delete(targetId: string, reason: string, source: MemorySource, createdBy: string): Promise<MemoryTombstone>`       | Writes a tombstone; the target becomes inactive                                                                                                                                                                                              |
| `get`       | `async get(id: string): Promise<MemoryRecord \| MemoryTombstone>`                                                         | Exact ULID; throws when not found                                                                                                                                                                                                            |
| `list`      | `async list(input?: { topic?, memory_type?, limit?, include_superseded? }): Promise<MemoryRecord[]>`                      | Newest first; bounded by `limit` (1–100)                                                                                                                                                                                                     |
| `search`    | `async search(input?: { query, topic?, memory_type?, limit?, max_chars?, include_superseded? }): Promise<MemoryRecord[]>` | BM25-ranked (see below)                                                                                                                                                                                                                      |
| `validate`  | `async validate(): Promise<MemoryValidationReport>`                                                                       | Re-reads and validates every canonical file; checks or rebuilds the cache. Never throws; returns `{ valid, records, tombstones, errors, cache }`                                                                                             |
| `export`    | `async export(): Promise<string>`                                                                                         | All records + tombstones as JSONL (one document per line)                                                                                                                                                                                    |
| `import`    | `async import(content: string, preview?: boolean): Promise<ImportReport>`                                                 | JSONL in. `preview: true` validates only — no writes, no lock contention on failure. Duplicate IDs, broken references, cycles, and compactness violations are rejected; a committed import may include `warnings` if cache maintenance fails |

`StoreMemoryInput`:

```ts
export interface StoreMemoryInput {
  memory_type: "semantic" | "episodic" | "procedural";
  record_type: "fact" | "decision" | "event" | "lesson";
  topic?: string;
  summary: string; // 1..240 Unicode characters
  details?: string | null; // at most 2000 characters and 12 non-empty lines
  source: MemorySource; // { kind, ref, revision }
  created_by: string;
  confidence: "confirmed" | "verified";
  tags?: string[];
}
```

## Search semantics

- Every term in the query must match; results are **ranked by BM25** through the FTS5 index (`porter unicode61` tokenizer, case-folded, prefix-aware — `deploy` matches `deployment`).
- Results are additionally filtered by `topic` / `memory_type` / active status after ranking, and the candidate set is fetched in pages so filters never starve the result count while matches remain.
- The result list is capped twice: by `limit` (count) and by `max_chars` (total serialized size, so a harness can feed results directly into a prompt).
- Searches that hit a stale cache resolve it first, according to `cache.stale_policy`.

## The memory tool contract

The same capabilities are exposed as named tools so harnesses (pi, OpenCode, or any MCP client) can call them without touching this API surface. Names are stable and MCP-compliant:

```text
memory_store, memory_supersede, memory_delete, memory_get, memory_list,
memory_search, memory_validate, memory_export, memory_import
```

Each tool has a Zod input schema (`MEMORY_TOOLS` / `findMemoryTool(name)` / the individual `*InputSchema` exports). The in-process tool runner validates input at runtime before the store sees it; the published `@neottia/memory-mcp` server converts the same schemas to JSON Schema for MCP clients. Configure it in any harness:

```json
{
  "mcpServers": {
    "memory": {
      "command": "pnpm",
      "args": ["dlx", "@neottia/memory-mcp"],
      "env": { "NEOTTIA_MEMORY_ENABLED": "true", "NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID": "my-project" }
    }
  }
}
```

## Error handling

| Error                                       | When                                                                                                                       | Handling suggestion                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ConfigError`                               | Invalid config file, shard, or env values; carries `validationPaths`                                                       | Fix the named paths                                                    |
| `MemoryError`                               | Base class for operation failures: disabled memory, invalid records, limits, unsafe paths, stale cache under `fail` policy | Message is precise; safe to surface to the user                        |
| `MemoryConflictError` extends `MemoryError` | Duplicate ID, superseding an inactive record                                                                               | Re-read state and retry deliberately                                   |
| `MemoryLockError`                           | Another read, recovery, cache task, or write holds the repository authority lease past the wait window                     | Retry; the lease is released automatically when the operation finishes |
| `MemorySecretError`                         | Content matched a secret pattern or the entropy heuristic                                                                  | Remove the secret; never store credentials                             |

## Security

- **Secret scanning on write**: PEM private keys, AWS access keys (`AKIA…`/`ASIA…`), GitHub tokens (`ghp_`, `gho_`, …), OpenAI-style keys (`sk-live-…`), and generic `password=…` / `api_key=…` assignments are rejected.
- **Entropy heuristic**: strings ≥ 32 characters without spaces, mixing letters and digits, with Shannon entropy ≥ 4.2, are treated as likely tokens. Disable via `security.entropy_heuristic: false` if it false-positives on your data.
- **Custom patterns**: `security.secret_patterns` accepts additional regex sources.
- **Path safety**: memory paths cannot escape the memory root; symlinks are rejected for files and ancestors; YAML aliases are refused; files must be valid UTF-8 with unique mapping keys.
- **Resource limits**: 16 MiB per file, 10 000 files, 256 MiB aggregate, 64 MiB payloads, 16 KiB queries — all configurable under `security.limits`.

## Concurrency

- Filesystem operations share the repository authority lease at `<authority>/.neottia/repository-store/`; legacy `<memory-root>/.locks/` artifacts are no longer used.
- Independent same-process calls queue with other filesystem domains, while cross-process callers wait for the same authority lease. Timeouts surface as `MemoryLockError`.
- A stale lease is reclaimed only when its same-host owner is conclusively dead. Unknown ownership is preserved.
- Reads, canonical transactions, recovery, and disposable cache work use the same lease, so no cooperating operation observes a batch mid-write.

## Troubleshooting

| Symptom                                                | Cause                                                 | Fix                                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Memory operation requires skills.memory.enabled=true` | Memory is off                                         | Set `skills.memory.enabled: true` or `NEOTTIA_MEMORY_ENABLED=true`                                 |
| `Config requires an explicit 'version: 1'`             | Config file missing the version key                   | Add `version: 1` at the top                                                                        |
| `Memory backend 'postgres' connection failed`          | PostgreSQL is unavailable or credentials are invalid  | Verify host, port, database, and credentials; retry when the database is reachable                 |
| `summary has N Unicode characters; limit is 240`       | Compactness violation                                 | Shorten `summary` (or `details`: 2000 chars / 12 lines)                                            |
| `Suspected secret at …`                                | Secret scanner match                                  | Remove the secret; adjust `security.secret_patterns` / entropy heuristic if it is a false positive |
| `Repository authority lease is busy`                   | Another repository operation exceeded its wait budget | Retry; check for stuck processes (a live owner is never stolen)                                    |
| `Memory cache is stale and cache.stale_policy is fail` | Read refused on stale index                           | Run `memory_validate`, or change the policy                                                        |
| Search returns nothing for known content               | Index stale or corrupt                                | `memory_validate` (it rebuilds), or delete `index.db`                                              |

## License

MIT — see [LICENSE](./LICENSE). Part of [Neottia](https://github.com/dragoscirjan/neottia).
