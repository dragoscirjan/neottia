# @neottia/repository-store

Hardened, domain-neutral persistence for canonical files and disposable SQLite caches inside a repository.

```sh
pnpm add @neottia/repository-store
```

Read the [complete Repository Store reference](https://github.com/dragoscirjan/neottia/blob/main/docs/repository-store.md).

The package owns byte-safe paths, SHA-256 revisions, one cross-process authority lease, durable rollback journals, atomic publication, and Node/Bun SQLite adapters. It deliberately does **not** define YAML or Markdown codecs, record schemas, search text, SQLite DDL, or query languages. Domain packages validate their complete proposed state while holding the lease, then publish exact bytes.

## Requirements

- Node.js 22.16 or newer, using `node:sqlite`.
- Bun 1.3.13 or newer, using `bun:sqlite`.
- Linux x64 or arm64 with libc/kernel support for `renameat2(..., RENAME_NOREPLACE)` and a recognized local ext4, XFS, Btrfs, tmpfs, or overlay filesystem.
- macOS 15 or 26 on x64 or arm64 with a local APFS volume that reports hard-link, persistent-identity, and exclusive-rename capabilities.
- Windows Server 2022 or 2025 on x64 with a fixed local NTFS volume that reports stable file-identity and hard-link capabilities.
- FreeBSD 14.x on x64 with Node.js and a local writable UFS2 volume. Bun and FreeBSD arm64 are not certified.
- Same-volume regular-file hard links.

Installation downloads the exact native prebuild for the package version, platform, and architecture from the matching GitHub Release. The installer verifies its Sigstore signature against Neottia's `CI` workflow identity and source commit, then verifies its byte size and SHA-256 digest before writing it. Repository Store checks the installed digest again before loading the addon. A missing asset, network failure, or intentionally omitted optional Sigstore verifier falls back to a local source build. Set `NEOTTIA_REPOSITORY_STORE_FORCE_SOURCE_BUILD=1` to request that path explicitly; it requires a C++17 compiler, Python, Make, and the platform development headers. A local build is not publisher-signed, but Repository Store records and checks its digest before loading it. An invalid signature, malformed bundle, or digest mismatch fails installation and never falls back.

The stable C Node-API addon is built from architecture-neutral source. Linux uses `renameat2(..., RENAME_NOREPLACE)` and `fsync`. macOS uses `renamex_np(..., RENAME_EXCL)` and `F_FULLFSYNC`. Windows uses `SetFileInformationByHandle(..., FileRenameInfoEx)` without replacement and the Node/Bun `fsyncSync` descriptor barrier; NTFS journals same-volume namespace mutations because Windows does not expose an unprivileged directory-descriptor flush through Node.js. FreeBSD uses exclusive regular-file hard-link publication and `fsync`; because FreeBSD 14 has no no-replace directory rename, the backend uses a complete regular-file authority lease and never applies its move primitive to directories. Repository authority acquisition checks the addon and filesystem capabilities before it creates claim or lease artifacts. FreeBSD UFS1, ZFS, network filesystems, FreeBSD arm64, Bun on FreeBSD, Windows arm64, ReFS, FAT, remote or removable Windows volumes, missing or unloadable addon builds, unavailable native operations, uncertified filesystems, and shared or network filesystems return `UNSUPPORTED_RUNTIME`. Leased canonical and cache operations, including read-only operations, are unavailable in those environments.

`diagnoseRepositoryPlatform(root)` reports the runtime tuple, loaded backend, filesystem type and locality, and active checks for no-replace publication, hard links, stable identity, and durability. The probe uses a private temporary directory below `root`, removes it on every path, and does not create repository authority artifacts. The `neottia doctor` command renders this report and supports deterministic JSON output.

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

Every write, remove, and move has an exact expected revision. Paths reject traversal, ambiguous separators, control characters, Windows-invalid characters and device names, components ending in a period or space, portable case/NFKC collisions, symbolic links, special files, and multiply linked files. Reads compare descriptor and path identity plus size, modification time, and change time around bounded reads.

## Lease and recovery

One lease lives at `<authority>/.neottia/repository-store/authority.lease`. It is a private directory on Linux, macOS, and Windows, and a complete regular file on FreeBSD. Native no-replace cleanup capability is required before its claim or lease is created. It covers canonical reads, validation, mutation, recovery, and cache work. True nested same-authority acquisition in one active async call chain is rejected; independent same-process callers are queued FIFO with the same abort, deadline, and acquisition-timeout budget used for cross-process contention. Owner and host metadata are read through fixed 4 KiB, no-follow descriptors with path and ancestor identity checks. Leases include a random owner token and local host/process evidence and reclaim only stale owners whose same-host death is conclusive.

Before publication, bounded before-images, staged bytes, and a digested manifest are synchronized beneath `transactions/<managed-root-id>/`. Segregating journals prevents one domain subtree from interpreting another subtree's relative paths while all domains still share the authority lease. An `.active` journal is rollback-required; `.committed` marks the commit point, and `.cleanup` is restart-idempotent cleanup-only state. Recovery runs automatically after acquiring the lease. Ambiguous operator changes fail closed and preserve evidence.

## Disposable SQLite caches

`openDisposableSqliteCache`, `rebuildDisposableSqliteCache`, and `removeDisposableSqliteCache` manage exact DB/WAL/SHM artifacts. Cache replacement tokens and allowed revisions are synchronized beneath `cache-publications/<managed-root-id>/`, so the next cache operation restores an evacuated active database after a crash before rebuilding. Runtime selection is lazy and loads only `node:sqlite` or `bun:sqlite`. Every connection enforces root SQL-byte, aggregate statement-parameter-byte, query-row, and query-result ceilings; `get()` is bounded automatically, `all()` cannot raise the root limits, aggregate schema SQL is bounded, and both active and candidate DB/WAL/SHM bytes share `maxTemporaryBytes`. Drivers must expose cursor iteration because eager unbounded `all()` fallback is rejected. Canonical files always win; a cache failure never rolls them back.

## Durability and threat model

Publication synchronizes a private same-directory temporary file, evacuates an expected destination with native `RENAME_NOREPLACE`, validates its exact identity and revision, and creates the new name exclusively with regular-file hard-link semantics. A raced evacuation or replacement is never overwritten: it is restored exclusively or retained as actionable recovery evidence. There is no check-then-rename fallback. File and directory synchronization failures are `DurabilityError`s with `operation`, `path`, and the original `cause`.

Package-owned files use mode `0600` and directories use `0700` where supported. Near-match and malformed unowned artifacts are preserved rather than recursively deleted.

## License

MIT
