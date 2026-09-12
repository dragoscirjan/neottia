# Memory backends

## Filesystem

`backend: filesystem` stores canonical YAML below the configured root. Relative roots resolve from the project CWD; absolute roots are supported but can unintentionally share authority across worktrees. Each project root should normally remain relative. The backend uses Repository Store leases and requires the [supported Linux environment](/get-started/requirements).

The SQLite `index.db`, WAL, and SHM files are disposable. `MemoryStore.close()` closes the backend and cache handles.

## PostgreSQL

`backend: postgres` stores canonical state in PostgreSQL rather than repository files. Configure `namespace.organization_id`, `project_id`, `default_topic`, and `scope` before sharing a database. Ownership and backup policy belong to the deployment.

YAML credentials must be exact environment references such as `${PG_USER}`. When absent, the `NEOTTIA_MEMORY_DB_PG_*` variables supply connection settings. `PostgresBackend` owns its pool when it creates it; call `MemoryStore.close()` to release it.

Filesystem and PostgreSQL authorities do not synchronize. Export from one backend, preview against the other, and then import. Legacy PostgreSQL rows remain in `scope: global`; assign another scope only through an explicit reviewed database migration.
