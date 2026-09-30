# Memory tools

Every delivery method uses these names, strict inputs, and Zod-derived outputs.

| Tool               | Exact input                                                                                                                | Exact output                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `memory_store`     | `memory_type`, `record_type`, `summary`, `source`, `created_by`, and `confidence`; optional `topic`, `details`, and `tags` | stored record with generated ULID |
| `memory_supersede` | every `memory_store` field plus the active `target_id`                                                                     | replacement record                |
| `memory_delete`    | `target_id`, `reason`, `source`, and `created_by`                                                                          | tombstone                         |
| `memory_get`       | Crockford ULID `id`                                                                                                        | record or tombstone               |
| `memory_list`      | optional `topic`, `memory_type`, `limit` of 1-100, and `include_superseded`                                                | records newest first              |
| `memory_search`    | `query`; optional `topic`, `memory_type`, `limit` of 1-100, `include_superseded`, and `max_chars` of 256-100000            | BM25-ranked records               |
| `memory_validate`  | `{}`                                                                                                                       | validation and cache report       |
| `memory_export`    | `{}`                                                                                                                       | JSONL string                      |
| `memory_import`    | JSONL `content`; optional `preview` (defaults to `true`)                                                                   | import report                     |

Store and supersede accept these type pairs: `semantic` with `fact`, `episodic` with `decision` or `event`, and `procedural` with `lesson`. Source has `kind: artifact | user-confirmed | discussion | tool-observation`, nullable `ref`, and nullable `revision`. Confidence is `confirmed | verified`. Tags must be unique. Summary is nonblank and at most 240 Unicode code points. Details is at most 2000 Unicode code points and 12 nonempty lines. Delete reasons are nonblank and at most 1000 characters.

Search queries are limited to 16 KiB of UTF-8 and import/export content to 64 MiB. A validation report contains `valid`, record and tombstone counts, errors, and cache outcome/evidence. Import reports contain `valid`, record and tombstone counts, errors, and optional warnings.

`memory_import` is preview-only when `preview` is omitted. Inspect `valid` and `errors`, then call with `preview: false` to publish. Prefer supersession to deletion when the old fact has historical value. Set the source kind honestly. Use `verified` only for artifact or tool evidence.

The library throws `MemoryError` subclasses for configuration, conflicts, locks, secrets, and schema failures. Tool hosts return those failures in their transport-specific error form. Common failures include an invalid ULID or enum, oversized text, duplicate tags, a suspected secret, a disabled shard, cache policy, or a configured storage limit.

## Cancellation

Every host forwards its request cancellation signal into Memory: the pi extension reads the tool call `AbortSignal`, the OpenCode plugin reads the invocation `abort`, and the MCP server passes the request handler `signal`. The direct library accepts an optional `MemoryOperationControl` (`{ signal, deadline }`) on every store operation.

Guarantees:

- An already-aborted (or past-deadline) call rejects with the stable `MemoryCancellationError` (`code: 'ABORTED'` or `'DEADLINE_EXCEEDED'`) **before** any backend, lease, or cache work, so it never mutates canonical state.
- Cancellation is checked at every safe phase boundary: before state reads, before search ranking, before validation, before import parsing and publication, and before cache rebuild starts.
- The atomic publication batch (`applyBatch`) and the PostgreSQL `COMMIT` are **non-interruptible commit boundaries**: a check runs immediately before, but never inside. Post-commit disposable-cache maintenance is bounded and also non-interruptible; if cache synchronization fails after publication the error says the canonical mutation committed.
- Cancelling a call that is only waiting for the shard authority lease stops promptly and leaves the FIFO queue healthy for the next caller.
- `memory_validate` surfaces cancellation inside its report (`valid: false`, cache outcome `skipped`); every other operation throws. Each transport surfaces the error in its native form: pi and OpenCode propagate the thrown error, MCP returns an `isError` result with the stable message.
