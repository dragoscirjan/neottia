# Issue tools

The library, MCP, Pi, and OpenCode surfaces expose the same generated contracts:

| Tool                             | Principal input                                                 | Output                                    |
| -------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| `issue_id`                       | none                                                            | `{id}`                                    |
| `issue_create`                   | `type`, `title`; optional body/creator/assignee/parent/metadata | hydrated issue                            |
| `issue_get`                      | `id`                                                            | hydrated issue                            |
| `issue_list`                     | optional status/type/assignee/parent/location/limit             | `{issues}`                                |
| `issue_search`                   | nonblank `query`; optional list filters, `max_bytes`            | ranked `{issues}`                         |
| `issue_update`                   | `id`, `expected_revision`, one or more mutable fields           | updated issue                             |
| `issue_transition`               | `id`, `status`, `expected_revision`                             | updated issue                             |
| `issue_comment`                  | `id`, `author`, `body`; optional revision                       | updated issue                             |
| `issue_relate`                   | source/target IDs, relationship; optional revision              | deterministic owner issue                 |
| `issue_unrelate`                 | source/target IDs, relationship, owner revision                 | deterministic owner issue                 |
| `issue_link_document`            | issue ID, document ID/version; optional revision                | updated issue                             |
| `issue_unlink_document`          | issue ID, document ID/version, revision                         | updated issue                             |
| `issue_validate`                 | none                                                            | bounded findings and cache state          |
| `issue_archive`, `issue_restore` | root issue ID and revision                                      | `{issues}` subtree                        |
| `issue_export`                   | none                                                            | native format/content/count               |
| `issue_import`                   | content; optional `preview` (default true)                      | planned/imported counts, warnings, errors |

Update, transition, archive, restore, relation removal, and link removal require `expected_revision`. Comment and additive/idempotent relation/link calls accept optional evidence and enforce it when supplied. For symmetric relations the lexical owner is the returned issue, so its returned revision is directly usable by `issue_unrelate`.

Link identity is a design-document ID plus optional pinned version, never a path. Library hosts inject `DesignDocumentReferenceResolver`; MCP uses `createIssueServer({resolver})`, Pi registration accepts `resolver`, and OpenCode composition uses `createIssuesPlugin({resolver})`. An idempotent link call still resolves the complete link snapshot; an unavailable target, unresolved reference, or malformed result batch fails without changing YAML.

Errors are JSON objects with `category`, stable `code`, `message`, `retryable`, and optional bounded structured `details`. Resolver errors retain target findings or unresolved reference/reason evidence; cache-policy errors retain the rebuild reason. Output that exceeds the effective configured or call-specific UTF-8 budget fails with `RESULT_TOO_LARGE`.
