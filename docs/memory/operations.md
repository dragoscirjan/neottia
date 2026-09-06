# Security, limits, and concurrency

## Secret scanning

Agents routinely see credentials. Memory **refuses to store** anything that looks like one, before the write happens:

- PEM private key blocks (`-----BEGIN … PRIVATE KEY-----`)
- AWS access keys (`AKIA…`, `ASIA…`)
- GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `ghp_…`)
- OpenAI-style keys (`sk-live-…`, `rk-live-…`, `sk-test-…`)
- Generic assignments: `password=…`, `api_key: …`, `token=…`
- **Entropy heuristic**: any string of 32+ characters without spaces, mixing letters and digits, with Shannon entropy ≥ 4.2, is treated as a likely token even if its format is unknown

Rejected writes fail with `Suspected secret at <path>; memory write rejected.` — the memory is **not** written, partially or otherwise.

Tuning (in `skills.memory.security`):

| Setting                    | Effect                                                                 |
| -------------------------- | ---------------------------------------------------------------------- |
| `secret_patterns`          | Additional regex sources treated as secrets                            |
| `entropy_heuristic: false` | Disable the unknown-token heuristic if it false-positives on your data |
| `limits.*`                 | Resource ceilings (see below)                                          |

Credentials belong in environment variables, never in memory — and never in the config file either (see [Configuration](./configuration.md)).

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
- Symbolic links are refused — for the files themselves and every ancestor directory.
- YAML is parsed strictly: duplicate keys are errors, aliases (`*ptr`) are refused, files must be valid UTF-8.
- Every canonical file is re-validated on load; a hand-edited file with an invalid type pairing, broken `supersedes` reference, or foreign namespace makes the shard refuse operations until fixed (run `memory_validate` for the exact error).

## Concurrency

- Each namespace shard (`organization/project/scope`) has its own lock, so independent projects and branches never block each other.
- A writer holds the lock for the whole operation — including the index refresh — and readers run inside the same barrier, so nothing ever observes a partial write.
- Acquisition waits up to 10 seconds (configurable per call in the library) before failing with `Shard barrier is busy`.
- A lock left behind by a crashed writer is stolen automatically, but **only** when it is older than 60 seconds _and_ the owning process is provably gone. A live writer — even a slow one — is never interrupted, and unknown ownership is always preserved.

## Troubleshooting

| Symptom                                                | Cause                                  | Fix                                                                                        |
| ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Memory operation requires skills.memory.enabled=true` | Memory is disabled                     | `skills.memory.enabled: true` or `NEOTTIA_MEMORY_ENABLED=true`                             |
| `Config requires an explicit 'version: 1'`             | Missing version key in the config file | Add `version: 1` at the top                                                                |
| `Memory backend 'postgres' is not implemented yet`     | Postgres backend not shipped           | Use `filesystem`; track [neottia#6](https://github.com/dragoscirjan/neottia/issues/6)      |
| `summary has N Unicode characters; limit is 240`       | Compactness violation                  | Shorten the summary (details: 2000 chars / 12 lines)                                       |
| `Suspected secret at …`                                | Secret scanner match                   | Remove the secret; tune `security.secret_patterns` / `entropy_heuristic` if false-positive |
| `Invalid memory record: record_type …`                 | Type pairing violated                  | Pair `semantic/fact`, `episodic/decision                                                   | event`, `procedural/lesson` |
| `Shard barrier is busy`                                | Concurrent writer held the lock > 10 s | Retry; investigate stuck processes (live owners are never stolen)                          |
| `Memory cache is stale and cache.stale_policy is fail` | Read refused on a stale index          | Run `memory_validate`, or change `stale_policy`                                            |
| `Memory path already exists`                           | Duplicate identity on store/import     | List first; supersede instead of re-storing                                                |
| Search returns nothing for known content               | Index stale or corrupt                 | `memory_validate` (rebuilds), or delete `index.db`                                         |
| `Duplicate memory ID` on validate                      | The same ULID exists twice on disk     | Remove the duplicate file; IDs are unique by construction when written through the tools   |
