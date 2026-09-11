---
"@neottia/repository-store": minor
"@neottia/memory-core": minor
"@neottia/issues": patch
"@neottia/design-docs": patch
---

Harden repository-local storage with a lazily loaded Linux Node-API `RENAME_NOREPLACE` backend, fail-closed exact publication, identity-bound lease cleanup, structured fsync failures, aggregate SQLite parameter and artifact limits, and exact disposable-cache removal. Complete filesystem Memory's migration to repository-store authority/cache primitives, add incremental bounded projection verification, and remove the deprecated unsafe shard-barrier and `SqliteIndex` exports.
