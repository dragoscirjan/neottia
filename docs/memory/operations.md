# Security, limits, and concurrency

## Secret scanning

Agents routinely see credentials. Memory **refuses to store** anything that looks like one, before the write happens:

- PEM private key blocks (`-----BEGIN … PRIVATE KEY-----`)
- AWS access keys (`AKIA…`, `ASIA…`)
- GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `ghp_…`)
- OpenAI-style keys (`sk-…`, `sk-proj-…`, `sk-live-…`, `rk-live-…`, `sk-test-…`)
- Generic assignments: `password=…`, `api_key: …`, `token=…`
- **Entropy heuristic**: any string of 32+ characters without spaces, mixing letters and digits, with Shannon entropy ≥ 4.2, is treated as a likely token even if its format is unknown

Rejected writes fail with `Suspected secret at <path>; memory write rejected.` The operation writes no memory data.

Tuning (in `skills.memory.security`):

| Setting                    | Effect                                                                 |
| -------------------------- | ---------------------------------------------------------------------- |
| `secret_patterns`          | Additional regex sources treated as secrets                            |
| `entropy_heuristic: false` | Disable the unknown-token heuristic if it false-positives on your data |
| `limits.*`                 | Resource ceilings (see below)                                          |

Credentials belong in environment variables. Do not store them in Memory or the config file (see [Configuration](./configuration.md)).

## Filesystem safety boundaries

Canonical YAML and SQLite cache artifacts are rejected when they are links or unsafe file types. Final publication atomically moves the expected file aside, checks its identity and revision, and creates the new destination through an exclusive no-overwrite regular-file link. A replacement introduced in the final mutation window is restored without overwrite or retained as actionable recovery evidence.

This protocol requires Linux x64 or arm64, the repository-store Node-API addon built with a C++17 compiler, Python, Make, and Linux development headers, kernel/libc `renameat2(..., RENAME_NOREPLACE)` support, and a recognized local ext4, XFS, Btrfs, tmpfs, or overlay filesystem with same-volume regular-file hard links. Repository authority acquisition fails with `UNSUPPORTED_RUNTIME` before creating claim or lease artifacts on macOS, Windows, shared/network filesystems, or when the addon is missing or unloadable; filesystem Memory cannot perform read-only leased operations there either. Protect the memory root with operating-system permissions because SQLite itself remains path-based. Filesystem Memory uses the repository authority lease and disposable-cache APIs exclusively; legacy `.locks`, shard barriers, and direct SQLite handles are not used.

## Resource limits

Because agents write autonomously, hard ceilings protect the store from runaway loops. All are configurable under `skills.memory.security.limits`:

| Limit             | Default                                          | Applies to                      |
| ----------------- | ------------------------------------------------ | ------------------------------- |
| `max_file_bytes`  | 16 MiB                                           | One memory file                 |
| `max_files`       | 10 000                                           | Total memory files in the shard |
| `max_total_bytes` | 256 MiB                                          | Aggregate memory size           |
| _(payload)_       | 64 MiB                                           | A single export/import payload  |
| _(query)_         | 16 KiB                                           | One search query                |
| _(compaction)_    | 240 chars summary; 2000 chars / 12 lines details | Every write                     |

## Path and content safety

- Memory paths cannot escape the memory root (`..`, absolute paths, and drive letters are rejected).
- Memory rejects symbolic links for files and every ancestor directory.
- YAML is parsed strictly: duplicate keys are errors, aliases (`*ptr`) are refused, files must be valid UTF-8.
- Every canonical file is re-validated on load; a hand-edited file with an invalid type pairing, broken `supersedes` reference, or foreign namespace makes the shard refuse operations until fixed (run `memory_validate` for the exact error).

## Concurrency

- Relative filesystem Memory roots share the repository authority lease with other filesystem domains; an explicitly configured absolute root remains its own authority.
- A writer holds the lease through canonical recovery, mutation, and cache refresh. Readers use the same lease, so cooperating operations never observe a partial write.
- Independent same-process operations queue FIFO. Acquisition waits up to 10 seconds by default before failing with `Repository authority lease is busy`.
- A lease left by a crashed writer is reclaimed only after its age threshold and conclusive same-host owner death. A live writer is never interrupted, and unknown ownership is preserved.

## Troubleshooting

| Symptom                                                | Cause                                                 | Fix                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Memory operation requires skills.memory.enabled=true` | Memory is disabled                                    | `skills.memory.enabled: true` or `NEOTTIA_MEMORY_ENABLED=true`                             |
| `Config requires an explicit 'version: 1'`             | Missing version key in the config file                | Add `version: 1` at the top                                                                |
| `Memory backend 'postgres' connection failed`          | PostgreSQL is unavailable or credentials are invalid  | Verify host, port, database, and credentials; retry when the database is reachable         |
| `summary has N Unicode characters; limit is 240`       | Compactness violation                                 | Shorten the summary (details: 2000 chars / 12 lines)                                       |
| `Suspected secret at …`                                | Secret scanner match                                  | Remove the secret; tune `security.secret_patterns` / `entropy_heuristic` if false-positive |
| `Invalid memory record: record_type …`                 | Type pairing violated                                 | Pair `semantic/fact`, `episodic/decision` or `event`, `procedural/lesson`                  |
| `Repository authority lease is busy`                   | Another operation held the lease past the wait budget | Retry; investigate stuck processes (live owners are never reclaimed)                       |
| `Memory cache is stale and cache.stale_policy is fail` | Read refused on a stale index                         | Run `memory_validate`, or change `stale_policy`                                            |
| `Memory path already exists`                           | Duplicate identity on store/import                    | List first; supersede instead of re-storing                                                |
| Search returns nothing for known content               | Index stale or corrupt                                | `memory_validate` (rebuilds), or delete `index.db`                                         |
| `Duplicate memory ID` on validate                      | The same ULID exists twice on disk                    | Remove the duplicate file; IDs are unique by construction when written through the tools   |
