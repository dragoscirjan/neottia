# @neottia/repository-store

Hardened, domain-neutral persistence for canonical files and disposable SQLite caches inside a repository.

The package owns byte-safe paths, SHA-256 revisions, one cross-process authority lease, durable rollback journals, atomic publication, and Node/Bun SQLite adapters. It deliberately does **not** define YAML or Markdown codecs, record schemas, search text, SQLite DDL, or query languages. Domain packages validate their complete proposed state while holding the lease, then publish exact bytes.

## Requirements

- Node.js 22.16 or newer, using `node:sqlite`.
- Bun 1.3.13 or newer, using `bun:sqlite`.
- Linux x64 or arm64 with libc/kernel support for `renameat2(..., RENAME_NOREPLACE)`.
- A C++17 compiler, Python, Make, and Linux development headers so the Node-API addon can be built during installation.
- A recognized local ext4, XFS, Btrfs, tmpfs, or overlay filesystem with same-volume regular-file hard links.

The addon is built from architecture-neutral source and is loaded lazily by both Node and Bun. Repository authority acquisition preflights the addon and authority filesystem before creating claim or lease artifacts. macOS, Windows, missing or unloadable addon builds, kernels/libcs without `renameat2`, unrecognized filesystems, and shared/network filesystems return `UNSUPPORTED_RUNTIME`; leased canonical and cache operations, including read-only operations, are unavailable there.

## Canonical files

```ts
import {
  DEFAULT_STORE_LIMITS,
  applyCanonicalBatch,
  readManagedFile,
  resolveManagedPath,
  resolveManagedRoot,
  withRepositoryLease,
} from "@neottia/repository-store";

const root = await resolveManagedRoot({
  authorityRoot: process.cwd(),
  managedPath: ".neottia/example",
  limits: DEFAULT_STORE_LIMITS,
});
const document = resolveManagedPath(root, "records/example.json");

await withRepositoryLease(root, async (lease) => {
  await applyCanonicalBatch(root, lease, [
    {
      kind: "write",
      path: document,
      bytes: new TextEncoder().encode('{"value":1}\n'),
      expected: "absent",
    },
  ]);
  const current = await readManagedFile(root, lease, document);
  console.log(current.revision);
});
```

Every write, remove, and move has an exact expected revision. Paths reject traversal, ambiguous separators, control characters, components ending in a period or space, portable case/NFKC collisions, symbolic links, special files, and multiply linked files. Reads compare descriptor and path identity plus size, modification time, and change time around bounded reads.

## Lease and recovery

One lease lives at `<authority>/.neottia/repository-store/authority.lease`. Native no-replace cleanup capability is required before its claim or lease is created. It covers canonical reads, validation, mutation, recovery, and cache work. True nested same-authority acquisition in one active async call chain is rejected; independent same-process callers are queued FIFO with the same abort, deadline, and acquisition-timeout budget used for cross-process contention. Owner and host metadata are read through fixed 4 KiB, no-follow descriptors with path and ancestor identity checks. Leases include a random owner token and local host/process evidence and reclaim only stale owners whose same-host death is conclusive.

Before publication, bounded before-images, staged bytes, and a digested manifest are synchronized beneath `transactions/<managed-root-id>/`. Segregating journals prevents one domain subtree from interpreting another subtree's relative paths while all domains still share the authority lease. An `.active` journal is rollback-required; `.committed` marks the commit point, and `.cleanup` is restart-idempotent cleanup-only state. Recovery runs automatically after acquiring the lease. Ambiguous operator changes fail closed and preserve evidence.

## Disposable SQLite caches

`openDisposableSqliteCache`, `rebuildDisposableSqliteCache`, and `removeDisposableSqliteCache` manage exact DB/WAL/SHM artifacts. Cache replacement tokens and allowed revisions are synchronized beneath `cache-publications/<managed-root-id>/`, so the next cache operation restores an evacuated active database after a crash before rebuilding. Runtime selection is lazy and loads only `node:sqlite` or `bun:sqlite`. Every connection enforces root SQL-byte, aggregate statement-parameter-byte, query-row, and query-result ceilings; `get()` is bounded automatically, `all()` cannot raise the root limits, aggregate schema SQL is bounded, and both active and candidate DB/WAL/SHM bytes share `maxTemporaryBytes`. Drivers must expose cursor iteration because eager unbounded `all()` fallback is rejected. Canonical files always win; a cache failure never rolls them back.

## Durability and threat model

Publication synchronizes a private same-directory temporary file, evacuates an expected destination with native `RENAME_NOREPLACE`, validates its exact identity and revision, and creates the new name exclusively with regular-file hard-link semantics. A raced evacuation or replacement is never overwritten: it is restored exclusively or retained as actionable recovery evidence. There is no check-then-rename fallback. File and directory synchronization failures are `DurabilityError`s with `operation`, `path`, and the original `cause`.

Package-owned files use mode `0600` and directories use `0700` where supported. Near-match and malformed unowned artifacts are preserved rather than recursively deleted.

## License

MIT
