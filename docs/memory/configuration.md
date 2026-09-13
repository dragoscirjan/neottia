# Configuring memory

Memory contributes the canonical `modules.memory` shard to `@neottia/config`. The deprecated `skills.memory` location remains accepted by `loadMemoryConfig` during migration. New hosts should register `memoryConfigContribution`, resolve one multi-module snapshot for the effective working directory, and pass `snapshot.get(memoryConfigContribution)` to `MemoryStore.fromConfig`.

## Where configuration is read from

The shared resolver reads optional global and project documents:

- Linux: `$XDG_CONFIG_HOME/neottia/config.yml`, or `~/.config/neottia/config.yml`;
- macOS: `$XDG_CONFIG_HOME/neottia/config.yml`, or `~/Library/Application Support/neottia/config.yml`;
- Windows: `%APPDATA%\neottia\config.yml`;
- project: `<cwd>/.neottia/config.yml`.

`NEOTTIA_GLOBAL_CONFIG_FILE` and `NEOTTIA_CONFIG_FILE` select explicit files. Relative project paths resolve against `cwd`. Every present file must contain the exact integer `version: 1`; missing default files are optional, while a missing explicitly selected file is an error.

`loadMemoryConfig` also retains `NEOTTIA_MEMORY_CONFIG_FILE` and `NEOTTIA_CONFIG_MEMORY_PATH` for standalone compatibility. Their defaults are `.neottia/config.yml` and the deprecated `skills.memory` path. Unrelated roots and shards are ignored only by this compatibility wrapper; a shared multi-module registry validates the complete root strictly. The package includes `config.schema.json`, generated from the standalone file-facing shard schema, for editor completion and CI validation.

`root` accepts relative, POSIX absolute, and drive absolute paths. Use one separator style and nonempty components. Dot components, repeated or trailing separators, and mixed slash styles are rejected.

## Resolution order

Configuration resolves once in this fixed order:

```text
built-in defaults < global file < project file < selected global profile
< selected project profile < environment bindings < explicit runtime overrides
```

Select one profile with `NEOTTIA_PROFILE` or the shared resolver's `profile` option. Environment variables override only the leaves listed below. Values without a listed environment binding resolve from defaults, files, profiles, and explicit runtime overrides. `security.secret_patterns` and every `security.limits` leaf are intentionally file/code-only.

## Config file example

```yaml
# .neottia/config.yml
version: 1
modules:
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

To migrate, move the existing mapping without changing its fields:

```yaml
# Deprecated
version: 1
skills:
  memory: { enabled: true }
```

```yaml
# Canonical
version: 1
modules:
  memory: { enabled: true }
```

Do not declare both paths in one source; the resolver reports the collision instead of guessing.

## Environment variable reference

All environment variables are optional. Booleans accept trimmed, case-insensitive `true`/`false` and `1`/`0`; integers accept trimmed base-10 digits. Invalid values fail with the variable name.

| Variable                                      | Config path                               | Default               |
| --------------------------------------------- | ----------------------------------------- | --------------------- |
| `NEOTTIA_GLOBAL_CONFIG_FILE`                  | _(global file location)_                  | Platform default      |
| `NEOTTIA_CONFIG_FILE`                         | _(project file location)_                 | —                     |
| `NEOTTIA_MEMORY_CONFIG_FILE`                  | _(deprecated project fallback)_           | `.neottia/config.yml` |
| `NEOTTIA_CONFIG_MEMORY_PATH`                  | _(deprecated standalone shard path)_      | `skills.memory`       |
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

PostgreSQL host, port, database, and TLS settings use `NEOTTIA_MEMORY_DB_PG_HOST`, `NEOTTIA_MEMORY_DB_PG_PORT`, `NEOTTIA_MEMORY_DB_PG_DATABASE`, and `NEOTTIA_MEMORY_DB_PG_SSL`.

## Credentials

`provider.db.pg.user` and `provider.db.pg.password` in YAML must be omitted or use one exact `${ENV_VAR}` reference. The shared resolver expands only the winning file/profile reference and does so exactly once. If the referenced variable contains `${SECOND_VAR}`, that text is passed literally to PostgreSQL. Missing referenced variables fail without placing credential values in diagnostics or provenance. Snapshot serialization replaces both credential fields with `[REDACTED]`.

When a credential field is omitted, `NEOTTIA_MEMORY_DB_PG_USER` or `NEOTTIA_MEMORY_DB_PG_PASSWORD` supplies a trusted literal fallback. Explicit typed runtime configuration may also contain resolved literals. The compatibility wrapper continues expanding exact references supplied through its historical override API once.

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
