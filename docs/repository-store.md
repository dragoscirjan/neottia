# Repository Store

`@neottia/repository-store` provides domain-neutral persistence for canonical repository files and disposable SQLite projections.

## Install and diagnose

```sh
pnpm add @neottia/repository-store
```

It requires Node.js 22.16 or newer or Bun 1.3.13 or newer, Linux x64 or arm64, C++17, Python, Make, Linux headers, `renameat2(RENAME_NOREPLACE)`, a recognized local ext4, XFS, Btrfs, tmpfs, or overlay filesystem, and same-volume regular-file hard links. Unsupported runtimes and network filesystems fail with `UnsupportedRuntimeError` before leased work.

## Paths, reads, and revisions

`resolveManagedRoot` creates a byte-safe authority and managed root. `validateRelativePath` and `resolveManagedPath` reject lexical problems such as traversal, mixed or ambiguous separators, controls, and unsafe portable components. Reads, scans, and mutations perform the filesystem checks that reject symlinks, special files, identity changes, and link-count violations. `scanManagedFiles` returns bounded managed files; `readManagedFile` reads one. `computeByteRevision` returns the `v1:<sha256>` exact-byte revision.

```ts
import {
  DEFAULT_STORE_LIMITS,
  applyCanonicalBatch,
  computeByteRevision,
  readManagedFile,
  resolveManagedPath,
  resolveManagedRoot,
  scanManagedFiles,
  withRepositoryLease,
} from "@neottia/repository-store";

const root = await resolveManagedRoot({
  authorityRoot: process.cwd(),
  managedPath: ".neottia/example",
  limits: DEFAULT_STORE_LIMITS,
});
const path = resolveManagedPath(root, "records/example.json");
const archive = resolveManagedPath(root, "archive/example.json");
const bytes = new TextEncoder().encode('{"value":1}\n');
console.log(computeByteRevision(bytes));
await withRepositoryLease(root, async (lease) => {
  await applyCanonicalBatch(root, lease, [{ kind: "write", path, bytes, expected: "absent" }]);
  const current = await readManagedFile(root, lease, path);
  console.log(await scanManagedFiles(root, lease, { under: [path] }));
  await applyCanonicalBatch(root, lease, [
    {
      kind: "move",
      from: path,
      to: archive,
      expectedSource: current.revision,
      expectedDestination: "absent",
    },
  ]);
  const archived = await readManagedFile(root, lease, archive);
  await applyCanonicalBatch(root, lease, [
    {
      kind: "remove",
      path: archive,
      expected: archived.revision,
    },
  ]);
});
```

`applyCanonicalBatch` accepts exact-revision write, remove, and move operations. It validates and journals a batch before publication. Moves affect two paths.

## Leases, cancellation, and recovery

`withRepositoryLease` serializes all domains under one authority. Options and `OperationControl` support abort signals, absolute deadlines, and acquisition waits. Independent same-process calls queue in order; nested acquisition in one active call chain fails.

Use an abort signal and absolute epoch deadline for bounded lease work. Recovery runs before the callback; an explicit pass returns the evidence arrays:

```ts
import { recoverCanonicalTransactions, withRepositoryLease } from "@neottia/repository-store";

const controller = new AbortController();
const report = await withRepositoryLease(
  root,
  (lease) =>
    recoverCanonicalTransactions(root, lease, {
      signal: controller.signal,
      deadline: Date.now() + 5000,
    }),
  { signal: controller.signal, deadline: Date.now() + 10000 },
);
console.log(report.rolledBack, report.cleanedPrepared, report.cleanedCommitted);
```

If operator changes make recovery ambiguous, Repository Store fails closed and preserves evidence under `.neottia/repository-store/`.

## Disposable SQLite

`openDisposableSqliteCache`, `rebuildDisposableSqliteCache`, and `removeDisposableSqliteCache` manage exact DB, WAL, and SHM artifacts. A domain supplies every `DisposableCacheSpecification` field. The `populate` callback projects canonical data into a new cache. The `healthCheck` callback rejects contradictory cache content.

```ts
import {
  computeByteRevision,
  openDisposableSqliteCache,
  rebuildDisposableSqliteCache,
  removeDisposableSqliteCache,
  resolveManagedPath,
  selectSqliteAdapter,
  type DisposableCacheSpecification,
} from "@neottia/repository-store";

const specification: DisposableCacheSpecification = {
  path: resolveManagedPath(root, "cache/example.sqlite"),
  applicationId: 0x4e544941,
  schemaVersion: 1,
  canonicalDigest: computeByteRevision(new TextEncoder().encode("canonical snapshot\n")),
  schemaSql: ["CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;"],
  async populate(database) {
    const insert = await database.prepare("INSERT INTO records (id, value) VALUES (?, ?)");
    await insert.run(["example", "projected value"]);
  },
  async healthCheck(database) {
    const count = await database.prepare("SELECT COUNT(*) AS count FROM records");
    const row = await count.get<{ count: number }>();
    if (row?.count !== 1) throw new Error("The cache projection is incomplete.");
  },
};

console.log((await selectSqliteAdapter()).runtime);
await withRepositoryLease(root, async (lease) => {
  const opened = await openDisposableSqliteCache(root, lease, specification);
  const cache = opened.state === "ready" ? opened : await rebuildDisposableSqliteCache(root, lease, specification);
  await cache.close();
  await removeDisposableSqliteCache(root, lease, specification.path);
});
```

Connections enforce SQL, parameter, row, result, and temporary-file limits. Canonical files remain authoritative after cache failure.

## Test-only fault injection

`@neottia/repository-store/testing` exports fault events and setter functions for downstream automated tests that simulate filesystem, lease, and transaction failures. Do not import this subpath from production code. Its hooks exist only to drive controlled crash and race tests; the main package API does not depend on them.

## Errors

Public errors include configuration, path safety, stale revision, contention, durability, recovery, cache synchronization, resource limit, and unsupported runtime categories. Inspect stable codes and bounded evidence. Retry only errors marked retryable.
