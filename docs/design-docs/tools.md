# Design Docs tools

All delivery methods use this registry order and reject unknown input fields.

| Tool                  | Exact input                                                                                                            | Exact output                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `document_id`         | `{}`                                                                                                                   | `{id}`                           |
| `document_create`     | `title` of 1-200 characters and `kind`; optional `created_by`, `body`, and `metadata`                                  | document record                  |
| `document_list`       | optional `kind`, `status`, `location`, `id`, `current_only`, and `limit` of 1-1000                                     | `{documents: summary[]}`         |
| `document_search`     | nonblank `query`; optional `kind`, `status`, `location`, `id`, `all_versions`, and `limit` of 1-1000                   | `{hits: searchHit[]}`            |
| `document_get`        | `id`; optional positive `version`                                                                                      | document record                  |
| `document_update`     | `id` and `expected_revision`; optional `title`, `kind`, `body`, and nullable `metadata`                                | document record                  |
| `document_transition` | `id`, `expected_revision`, `to`, nonblank `intent` up to 1000 characters, `actor` up to 200 characters, and `evidence` | document record                  |
| `document_version`    | `id` and the latest approved `expected_revision`; optional `title`, `kind`, `body`, and nullable `metadata`            | successor document record        |
| `document_validate`   | optional `id` and `cross_domain`                                                                                       | validation report                |
| `document_archive`    | `id` and `expected_revision`                                                                                           | operation report                 |
| `document_restore`    | `id` and `expected_revision`                                                                                           | operation report                 |
| `document_export`     | `{}`                                                                                                                   | `{content}` deterministic bundle |
| `document_import`     | `content`; optional `preview`; optional `format`, which is `native` or `harnessctl-v2`                                 | import report                    |

A summary contains `id`, `path`, `revision`, `location`, `superseded`, `archived`, `title`, `kind`, `status`, and `version`. A document record adds `metadata` and `body`. A search hit adds `score` and `snippet`. A validation report contains `valid`, document and lineage counts, findings, and cache state. Archive and restore return `{id, location, documents}`. Import returns `preview`, `valid`, `additions`, `conflicts`, `unsupported`, `warnings`, and `path_mappings`.

Transition evidence requires `source: human-ui | caller-attestation | policy`; optional `reference` is at most 1000 characters and optional `note` is at most 4000. Import previews when `preview` is omitted. Updates, transitions, versioning, archive, and restore require `v1:<sha256>` revisions.

Every tool error contains `category`, `code`, `message`, `paths`, `retryable`, and optional bounded `details`. Input and output failures use `TOOL_INPUT_INVALID` and `TOOL_OUTPUT_INVALID`; oversized output uses `TOOL_RESULT_LIMIT`. Store errors preserve lifecycle, stale revision, link, path, contention, durability, recovery, cache, and resource-limit codes. Fetch current state before retrying a stale mutation.
