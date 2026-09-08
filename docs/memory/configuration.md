# Configuring memory

Memory is configured through a **shard**: the `skills.memory` section of the project configuration file. Library users can override values in code, while environment variables override only the bindings explicitly listed below. You only need to configure what you want to change — everything else has a working default.

## Where the configuration lives

| What                     | Resolution                                                                             | Default                 |
| ------------------------ | -------------------------------------------------------------------------------------- | ----------------------- |
| Config file              | `NEOTTIA_CONFIG_FILE` → `NEOTTIA_MEMORY_CONFIG_FILE` → `<project>/.neottia/config.yml` | The project config file |
| Memory section inside it | `NEOTTIA_CONFIG_MEMORY_PATH`                                                           | `skills.memory`         |

The file must start with `version: 1`. Sections belonging to other modules are ignored by memory. A generated [JSON Schema](https://github.com/dragoscirjan/neottia/blob/main/packages/memory-core/config.schema.json) is included with `@neottia/memory-core` for editor completion and CI validation.

## Minimal setup

```yaml
# .neottia/config.yml
version: 1
skills:
  memory:
    enabled: true
```

That is enough for an agent to store and search memories in `.neottia/memory/` with the namespace `local/project`.

## Full reference

```yaml
version: 1
skills:
  memory:
    enabled: true # master switch; every operation refuses to run while false
    root: .neottia/memory # where memory files (and the index) are stored, relative to the project

    backend: filesystem # or postgres for a shared PostgreSQL memory store

    namespace: # identity of this memory shard
      organization_id: acme # who owns the project
      project_id: website # which project
      default_topic: general # topic used when a record does not specify one
      scope: global # optional third dimension: branch / workspace id

    retrieval: # defaults for list and search
      limit: 8 # maximum results returned (1–100)
      max_chars: 12000 # search result budget in JSON characters (256–100000)
      include_superseded: false # whether corrected records show up by default

    cache: # the SQLite index is a disposable cache of the YAML files
      max_age_ms: 300000 # index considered stale after this long (0 = always stale)
      stale_policy: prompt # what to do when stale: prompt | rebuild | fail

    security:
      secret_patterns: [] # extra regexes; a match rejects the write
      entropy_heuristic: true # reject high-entropy strings (likely tokens)
      limits:
        max_file_bytes: 16777216 # largest single memory file (16 MiB)
        max_files: 10000 # maximum number of memory files
        max_total_bytes: 268435456 # aggregate size cap (256 MiB)
```

## Resolution order

Each explicitly environment-bound value resolves in this order:

```text
code override (library users)  >  listed environment binding  >  config file  >  default
```

Values without a listed binding resolve from code, the config file, and defaults; similarly named environment variables have no effect.

## Environment variables

All optional. Booleans accept `true/false/1/0`; integers accept plain digits. An invalid value fails with the variable name in the message.

| Variable                                                              | Sets                                  | Default                                   |
| --------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------- |
| `NEOTTIA_CONFIG_FILE`                                                 | Location of the config file           | —                                         |
| `NEOTTIA_MEMORY_CONFIG_FILE`                                          | Fallback location                     | `.neottia/config.yml`                     |
| `NEOTTIA_CONFIG_MEMORY_PATH`                                          | Section path inside the config object | `skills.memory`                           |
| `NEOTTIA_MEMORY_ENABLED`                                              | `enabled`                             | `false`                                   |
| `NEOTTIA_MEMORY_ROOT`                                                 | `root`                                | `.neottia/memory`                         |
| `NEOTTIA_MEMORY_BACKEND`                                              | `backend`                             | `filesystem`                              |
| `NEOTTIA_MEMORY_NAMESPACE_ORGANIZATION_ID`                            | `namespace.organization_id`           | `local`                                   |
| `NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID`                                 | `namespace.project_id`                | `project`                                 |
| `NEOTTIA_MEMORY_NAMESPACE_DEFAULT_TOPIC`                              | `namespace.default_topic`             | `general`                                 |
| `NEOTTIA_MEMORY_NAMESPACE_SCOPE`                                      | `namespace.scope`                     | `global`                                  |
| `NEOTTIA_MEMORY_RETRIEVAL_LIMIT`                                      | `retrieval.limit`                     | `8`                                       |
| `NEOTTIA_MEMORY_RETRIEVAL_MAX_CHARS`                                  | `retrieval.max_chars`                 | `12000`                                   |
| `NEOTTIA_MEMORY_RETRIEVAL_INCLUDE_SUPERSEDED`                         | `retrieval.include_superseded`        | `false`                                   |
| `NEOTTIA_MEMORY_CACHE_MAX_AGE_MS`                                     | `cache.max_age_ms`                    | `300000`                                  |
| `NEOTTIA_MEMORY_CACHE_STALE_POLICY`                                   | `cache.stale_policy`                  | `prompt`                                  |
| `NEOTTIA_MEMORY_SECURITY_ENTROPY_HEURISTIC`                           | `security.entropy_heuristic`          | `true`                                    |
| `NEOTTIA_MEMORY_DB_PG_USER`                                           | Postgres user fallback                | —                                         |
| `NEOTTIA_MEMORY_DB_PG_PASSWORD`                                       | Postgres password fallback            | —                                         |
| `NEOTTIA_MEMORY_DB_PG_HOST` / `..._PORT` / `..._DATABASE` / `..._SSL` | Postgres connection settings          | `localhost` / `5432` / `neottia` / `true` |

This table is the complete environment-binding contract; names inferred from config paths are not supported. In particular, `security.secret_patterns` and every `security.limits` value are file/code-only. Secret patterns are an ordered array, and limits are a security-sensitive group that should remain reviewable in one configuration document; accepting invented scalar or encoded environment forms would make deployment behavior ambiguous.

### PostgreSQL credentials

YAML credential fields must be absent or contain one exact environment reference, such as `user: "${PG_USER}"`. `loadMemoryConfig` expands that reference once. If `PG_USER` itself contains text such as `${SECOND_VAR}`, that text is passed literally to PostgreSQL rather than expanded again. When the fields are absent, `NEOTTIA_MEMORY_DB_PG_USER` and `NEOTTIA_MEMORY_DB_PG_PASSWORD` remain the defaults. Literal credentials in YAML are rejected.

## Cache policy

The search index is rebuilt automatically from the YAML files when its content hash no longer matches, or when it is older than `max_age_ms`. `stale_policy` decides what _stale_ means for reads:

| Policy    | Behavior                                                                                                             | Best for                         |
| --------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `prompt`  | A host-provided callback decides before rebuilding; without one, in-process plugins and MCP servers silently rebuild | Interactive embeddings (default) |
| `rebuild` | Rebuild immediately, no questions                                                                                    | MCP servers, automation          |
| `fail`    | Refuse the read with a clear error until `memory_validate` runs                                                      | CI, strict environments          |

Deleting `index.db` manually is always safe; it is rebuilt from the YAML files.

## Workspaces and branches

Each git worktree has its own `root` directory, so two branches never overwrite each other's filesystem memories. For a shared, cross-machine memory, select `backend: postgres`; PostgreSQL separates records by organization, project, and scope.

When upgrading an existing PostgreSQL database, rows created before scoped storage are intentionally retained in the `global` scope. The backend cannot infer a branch or workspace from those rows. Keep the deployment on `scope: global` to use them, or perform an explicit, reviewed SQL migration that assigns known rows to a new scope before switching deployments; never bulk-assign legacy rows automatically when multiple scopes share the database.
