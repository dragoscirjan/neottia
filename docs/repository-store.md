# Repository store

`@neottia/repository-store` is the local persistence layer shared by Neottia filesystem domains. It keeps canonical repository files authoritative while treating SQLite as a disposable projection.

## Authority model

Relative domain roots share one lease beneath the repository's `.neottia/repository-store/` directory. Acquisition preflights native no-replace cleanup support for the authority filesystem before creating claim or lease artifacts. The lease covers recovery, canonical reads, complete proposed-state validation, publication, and cache synchronization. Independent same-process callers across domains queue FIFO; only true nested acquisition in the active async call chain is rejected. Queue waiting and cross-process waiting share abort, absolute-deadline, and acquisition-timeout budgets. Lease metadata is capped at 4 KiB and read through no-follow descriptors with path and ancestor identity revalidation.

Memory retains compatibility with an explicitly configured absolute root. In that mode, the absolute root is its own authority and does not coordinate with domains under the repository authority. Handles from different authorities fail closed when combined.

## Recovery

Canonical batches use exact SHA-256 byte revisions. Before any canonical path changes, repository-store synchronizes bounded before-images, staged bytes, and a digested manifest beneath a managed-root-specific transaction directory. Final publication evacuates an expected regular file with native Linux `RENAME_NOREPLACE`, authenticates its identity and revision, and creates the destination exclusively; replacements that race the final mutation are restored without overwrite or retained as recovery evidence. Moves count as two affected paths. A process restart rolls an active transaction and any authenticated evacuation back before serving reads. Once the committed marker is durable, recovery preserves post-state.

SQLite databases are caches only. Missing, stale, incompatible, or corrupt caches can be rebuilt from validated canonical files. SQL and aggregate positional/named statement parameters use UTF-8/blob byte limits; `get()` and cursor-backed `all()` are connection-bounded; domain schema SQL is bounded cumulatively; and active and candidate DB/WAL/SHM sizes share the inclusive `maxTemporaryBytes` ceiling. Callers can remove exact cache artifacts with `removeDisposableSqliteCache`. Detected replacements are preserved and are not passed to native SQLite close.

## Platform limits

SQLite caches require Node.js 22.16 or newer or Bun 1.3.13 or newer. Destructive publication is supported on Linux x64/arm64 when the architecture-neutral Node-API addon can be built with a C++17 toolchain, Python, Make, libc/Linux headers, and `renameat2(..., RENAME_NOREPLACE)` support. Recognized ext4, XFS, Btrfs, tmpfs, and overlay local filesystems also need same-volume regular-file hard links. macOS, Windows, missing/unloadable native builds, unsupported kernels/libcs, unrecognized filesystems, and shared/network filesystems fail with `UNSUPPORTED_RUNTIME` during authority preflight; leased canonical and cache operations, including read-only operations, are unavailable there, and there is no check-then-rename fallback. Linux hosts receive parent-directory `fsync`. Synchronization failures surface as `DurabilityError` with operation/path evidence and the original cause. SQLite remains path-based, so artifacts are identity-checked around every package-controlled phase.
