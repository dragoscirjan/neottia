# Issue tools

All delivery methods use this registry order and reject unknown input fields. Every tool accepts an optional positive absolute `deadline` unless stated otherwise below.

| Tool                    | Exact input                                                                                                                                                | Exact output                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `issue_id`              | optional `deadline`                                                                                                                                        | `{id}`                                        |
| `issue_create`          | `type` and `title` up to 500 characters; optional `body` up to 1 MiB, `created_by`, `assigned_to`, `parent`, `metadata`, and `deadline`                    | hydrated issue                                |
| `issue_get`             | `id`; optional `deadline`                                                                                                                                  | hydrated issue                                |
| `issue_list`            | optional `status`, `type`, `assignee`, `parent`, `location`, `limit` of 1-100, and `deadline`                                                              | `{issues}`                                    |
| `issue_search`          | nonblank `query` up to 16 KiB; optional `status`, `type`, `assignee`, `parent`, `location`, `limit` of 1-100, `max_bytes` of 1024-16777216, and `deadline` | ranked `{issues}`                             |
| `issue_update`          | `id`, `expected_revision`, and at least one of `title`, `body`, nullable `assigned_to`, nullable `parent`, or `metadata`; optional `deadline`              | updated issue                                 |
| `issue_transition`      | `id`, `status`, and `expected_revision`; optional `deadline`                                                                                               | updated issue                                 |
| `issue_comment`         | `id`, `author`, and `body` up to 64 KiB; optional `expected_revision` and `deadline`                                                                       | updated issue                                 |
| `issue_relate`          | `source_id`, `target_id`, and `relationship`; optional `expected_revision` and `deadline`                                                                  | deterministic owner issue                     |
| `issue_unrelate`        | `source_id`, `target_id`, `relationship`, and `expected_revision`; optional `deadline`                                                                     | deterministic owner issue                     |
| `issue_link_document`   | `id` and `document_id`; optional positive `document_version`, `expected_revision`, and `deadline`                                                          | updated issue                                 |
| `issue_unlink_document` | `id`, `document_id`, and `expected_revision`; optional positive `document_version` and optional `deadline`                                                 | updated issue                                 |
| `issue_validate`        | optional `deadline`                                                                                                                                        | graph and cache report                        |
| `issue_archive`         | `id` and `expected_revision`; optional `deadline`                                                                                                          | `{issues}` subtree                            |
| `issue_restore`         | `id` and `expected_revision`; optional `deadline`                                                                                                          | `{issues}` subtree                            |
| `issue_export`          | optional `deadline`                                                                                                                                        | `{format: neottia-issues-v1, content, count}` |
| `issue_import`          | `content` up to 64 MiB; optional `preview` and `deadline`                                                                                                  | import report                                 |

Relationships are `depends_on`, `relates_to`, `duplicates`, and `supersedes`. Change dependencies through relation tools, not `issue_update`. Additive relationship and link calls are idempotent. Comments and additive calls enforce an optional revision when supplied. Update, transition, archive, restore, unrelate, and unlink require `v1:<sha256>` revision evidence.

A hydrated issue contains the canonical fields plus `revision`, `location`, `children`, `blocks`, `blocked_by`, and `related_to`. Validation returns `valid`, active, archived, and total counts, findings, and cache state. Import previews by default and returns `valid`, `preview`, `planned`, `imported`, `warnings`, and `errors`.

Errors contain `category`, stable `code`, `message`, `retryable`, and optional bounded `details`. `TOOL_INPUT_INVALID` covers strict contract failures; `TOOL_OUTPUT_INVALID` covers an invalid internal result; `RESULT_TOO_LARGE` covers serialized output. Resolver, stale revision, graph, path, contention, recovery, cache, and resource errors retain their source code and bounded evidence.
