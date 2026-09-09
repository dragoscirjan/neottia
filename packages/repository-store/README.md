# @neottia/repository-store

Hardened, domain-neutral persistence for canonical files and disposable SQLite caches inside a repository.

The package owns byte-safe paths, SHA-256 revisions, one cross-process authority lease, durable rollback journals, atomic publication, and Node/Bun SQLite adapters. It deliberately does **not** define YAML or Markdown codecs, record schemas, search text, SQLite DDL, or query languages. Domain packages validate their complete proposed state while holding the lease, then publish exact bytes.

## Requirements

- Node.js 22.16 or newer, using `node:sqlite`.
- Bun 1.3.13 or newer, using `bun:sqlite`.
- A local filesystem with reliable atomic directory creation and same-volume rename.

Shared/network filesystems are unsupported because their lock, rename, and durability behavior cannot be established portably.

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

Every write, remove, and move has an exact expected revision. Paths reject traversal, ambiguous separators, control characters, portable case/NFKC collisions, symbolic links, special files, and multiply linked files. Reads compare descriptor and path identity plus size, modification time, and change time around bounded reads.

## Lease and recovery

One lease lives at `<authority>/.neottia/repository-store/authority.lease`. It covers canonical reads, validation, mutation, recovery, and cache work. Leases are non-reentrant in one process, include a random owner token and local host/process evidence, and reclaim only stale owners whose same-host death is conclusive. A complete atomic initialization claim makes crashes before owner publication recoverable without treating unrelated missing-owner locks as safe to delete. `AbortSignal` and absolute deadlines interrupt asynchronous contention waits.

Before publication, bounded before-images, staged bytes, and a digested manifest are synchronized beneath `transactions/<managed-root-id>/`. Segregating journals prevents one domain subtree from interpreting another subtree's relative paths while all domains still share the authority lease. An `.active` journal is rollback-required; `.committed` marks the commit point, and `.cleanup` is restart-idempotent cleanup-only state. Recovery runs automatically after acquiring the lease. Ambiguous operator changes fail closed and preserve evidence.

## Disposable SQLite caches

`openDisposableSqliteCache` and `rebuildDisposableSqliteCache` accept domain-owned application ID, schema version/DDL, canonical digest, population callback, and health check. Runtime selection is lazy and loads only `node:sqlite` or `bun:sqlite`. Exact active-cache snapshots prevent activation or native close from deleting DB/WAL/SHM replacements detected during asynchronous callbacks. Canonical files always win; a cache failure never rolls them back.

## Durability and threat model

Publication uses a private same-directory temporary file, file `fsync`, atomic rename, and parent-directory `fsync` on POSIX. Windows has no equivalent directory-sync guarantee, so restart durability is limited to guarantees provided by Windows and Node/Bun. SQLite accepts paths rather than file descriptors; DB/WAL/SHM identity is checked around package-controlled phases, but no portable implementation can prevent continuous hostile swapping without an `openat` API or custom SQLite VFS.

Package-owned files use mode `0600` and directories use `0700` where supported. Near-match and malformed unowned artifacts are preserved rather than recursively deleted.

## License

MIT
