# Repository store

`@neottia/repository-store` is the local persistence layer shared by Neottia filesystem domains. It keeps canonical repository files authoritative while treating SQLite as a disposable projection.

## Authority model

Relative domain roots share one lease beneath the repository's `.neottia/repository-store/` directory. The lease covers recovery, canonical reads, complete proposed-state validation, publication, and cache synchronization, so another cooperating process cannot observe a half-published batch. Lease initialization uses a complete atomic claim, allowing a conclusively dead initializer to be recovered without deleting unrelated missing-owner locks.

Memory retains compatibility with an explicitly configured absolute root. In that mode, the absolute root is its own authority and does not coordinate with domains under the repository authority. Handles from different authorities fail closed when combined.

## Recovery

Canonical batches use exact SHA-256 byte revisions. Before any canonical path changes, repository-store synchronizes bounded before-images, staged bytes, and a digested manifest beneath a managed-root-specific transaction directory. This keeps relative paths from different domain roots separate while retaining one shared authority lease. A process restart rolls an active transaction back before serving reads. Once the committed state marker is durable, recovery preserves canonical post-state and transitions to restart-idempotent cleanup. Unexpected current bytes are never overwritten automatically.

SQLite databases are caches only. Missing, stale, incompatible, or corrupt caches can be rebuilt from validated canonical files. Active DB/WAL/SHM identities are snapshotted before rebuild and checked again before activation; detected replacements are preserved and are not passed to native SQLite close. If cache synchronization fails after publication, the operation reports that canonical memory committed so callers do not retry as if nothing happened.

## Platform limits

Local filesystems with reliable atomic `mkdir` and same-volume `rename` are required. Shared and network filesystems are unsupported. POSIX hosts receive parent-directory `fsync`; Windows crash durability is limited to the guarantees exposed by the runtime. SQLite's path-only API also means continuous hostile path swapping cannot be prevented portably, though repository-store validates database, WAL, and SHM artifacts around package-controlled phases.
