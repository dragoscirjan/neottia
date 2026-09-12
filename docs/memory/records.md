# Records, lifecycle, and storage

## What a record looks like

Every memory is one YAML file under the memory root, named after its ULID identifier:

```text
.neottia/memory/
├── facts/                                  # semantic knowledge
│   └── 01J8Z0V1A2B3C4D5E6G7H8J9K0.yaml
├── decisions/                              # episodic: what was decided
├── events/                                 # episodic: what happened
├── lessons/                                # procedural: what was learned
├── tombstones/                             # retirement records
└── index.db                                # disposable search cache
```

Example `facts/01J8Z0V1A2B3C4D5E6G7H8J9K0.yaml`:

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

## The two taxonomies

`memory_type` describes the _nature_ of the knowledge and must pair with `record_type`:

| `memory_type` | Allowed `record_type` | Use it for                          |
| ------------- | --------------------- | ----------------------------------- |
| `semantic`    | `fact`                | Stable truths about the project     |
| `episodic`    | `decision`, `event`   | What was decided or what happened   |
| `procedural`  | `lesson`              | How to do things; pitfalls to avoid |

## Field rules

| Field         | Rule                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `summary`     | Required; at most **240 Unicode characters** when an agent writes it (files can hold up to 1000 when loaded)   |
| `details`     | Optional; at most **2000 Unicode characters** and **12 non-empty lines** on write                              |
| `source.kind` | `artifact`, `user-confirmed`, `discussion`, or `tool-observation`. This records where the knowledge came from. |
| `confidence`  | `confirmed` or `verified`; **`verified` requires source kind `artifact` or `tool-observation`**                |
| `topic`       | Defaults to the configured `default_topic`                                                                     |
| `tags`        | Sorted, unique                                                                                                 |

Write-time limits prevent unbounded prose. Memory records contain short summaries rather than full documents.

## Lifecycle

Memory is **append-only**. Records are never edited or deleted in place.

### Correcting: supersede

A new record references the old one through `supersedes`:

```yaml
id: 01J8Z0W1A2B3C4D5E6G7H8J9K0
summary: The site deploys with pnpm; npm is blocked via packageManager
supersedes:
  - 01J8Z0V1A2B3C4D5E6G7H8J9K0
# ...
```

The old record becomes **inactive**: hidden from `memory_list` and `memory_search` unless you pass `include_superseded: true`, but still on disk and retrievable by ID. Supersession chains are validated for cycles and broken references on every read.

### Retiring: tombstone

A tombstone in `tombstones/` marks a record as removed, with a reason and author:

```yaml
schema_version: 1
id: 01J8Z0X1A2B3C4D5E6G7H8J9K0
target_id: 01J8Z0W1A2B3C4D5E6G7H8J9K0
reason: No longer applicable after the monorepo migration
source:
  kind: user-confirmed
  ref: null
  revision: null
created_at: 2026-09-06T18:00:00.000Z
created_by: agent:pi
```

A record is **active** when nothing supersedes it and no tombstone targets it. `memory_validate` reports counts for both.

## Moving memory between projects

`memory_export` produces JSONL (one record or tombstone per line). `memory_import` accepts it back, with:

- **full validation before any write**: schema, namespaces, duplicate IDs, supersession references, cycles, compactness;
- a **preview mode** (`preview: true`) that reports what would happen without writing anything;
- identical diagnostics for preview and real import, including line numbers.

## Why files instead of a database

- **Reviewable**: memory changes appear in `git diff` and pull requests, next to the code they describe.
- **Portable**: no server, no credentials, no vendor.
- **Durable**: the YAML files are the truth; the search index can be deleted and rebuilt at any time.

The SQLite index exists only for fast, ranked search. See [Configuration](./configuration.md#cache-policy) for how staleness is handled.

## Ignore the disposable cache

Track the YAML directories because they are the canonical memory. Add these exact entries to the consumer project's `.gitignore`:

```text
.neottia/memory/index.db
.neottia/memory/index.db-wal
.neottia/memory/index.db-shm
```

Do not ignore `.neottia/memory/` as a whole. Deleting any of the three SQLite files is safe because memory rebuilds them from YAML.
