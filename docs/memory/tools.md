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
| `memory_import`    | JSONL `content`; optional `preview`                                                                                        | import report                     |

Store and supersede accept these type pairs: `semantic` with `fact`, `episodic` with `decision` or `event`, and `procedural` with `lesson`. Source has `kind: artifact | user-confirmed | discussion | tool-observation`, nullable `ref`, and nullable `revision`. Confidence is `confirmed | verified`. Tags must be unique. Summary is nonblank and at most 240 Unicode code points. Details is at most 2000 Unicode code points and 12 nonempty lines. Delete reasons are nonblank and at most 1000 characters.

Search queries are limited to 16 KiB of UTF-8 and import/export content to 64 MiB. A validation report contains `valid`, record and tombstone counts, errors, and cache outcome/evidence. Import reports contain `valid`, record and tombstone counts, errors, and optional warnings.

`memory_import` currently writes when `preview` is omitted. Always preview with `preview: true`, inspect `valid` and `errors`, then call with `preview: false`. Prefer supersession to deletion when the old fact has historical value. Set the source kind honestly. Use `verified` only for artifact or tool evidence.

The library throws `MemoryError` subclasses for configuration, conflicts, locks, secrets, and schema failures. Tool hosts return those failures in their transport-specific error form. Common failures include an invalid ULID or enum, oversized text, duplicate tags, a suspected secret, a disabled shard, cache policy, or a configured storage limit.
