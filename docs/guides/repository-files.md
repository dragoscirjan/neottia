# Repository files and Git

Use these exact tracking rules. Do not ignore all of `.neottia/`.

| Path                                                                    | Role                                                  | Git treatment                |
| ----------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------- |
| `.neottia/config.yml`                                                   | Shared user configuration                             | Track                        |
| `.neottia/memory/{facts,decisions,events,lessons,tombstones}/**/*.yaml` | Canonical filesystem Memory                           | Track                        |
| `.neottia/issues/**/*.yml`                                              | Active and archived Issues                            | Track                        |
| `.neottia/design-docs/**/*.md`                                          | Active and archived Design Docs                       | Track                        |
| `.neottia/memory/index.db*`                                             | Memory SQLite cache                                   | Ignore                       |
| `.neottia/cache/`                                                       | Issues and Design Docs caches                         | Ignore                       |
| `.neottia/repository-store/`                                            | Lease, journal, cache-publication, and recovery state | Ignore                       |
| `.neottia/searchable/`                                                  | Reserved by foundation configuration                  | No current package writes it |

Add these entries to the consuming project's `.gitignore`:

```text
.neottia/memory/index.db
.neottia/memory/index.db-wal
.neottia/memory/index.db-shm
.neottia/cache/
.neottia/repository-store/
```

PostgreSQL Memory has no repository-local canonical YAML. Back it up with PostgreSQL tools according to deployment ownership.
