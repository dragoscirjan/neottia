# Issue lifecycle

Create starts an issue in `open`. Update the title, body, assignee, parent, or metadata with `issue_update` and the exact current revision. Add or remove dependencies with `issue_relate` or `issue_unrelate` and `relationship: "depends_on"`. Transition to `in_progress`, `done`, or `closed` with `issue_transition`. Carry every returned revision forward.

`issue_comment` appends an immutable comment. Its revision is optional, but supplying it detects concurrent changes. Additive relationship and document-link calls are idempotent and also accept optional revision evidence.

`issue_archive` and `issue_restore` require the root issue revision and move its complete child subtree. They report every affected issue. There is no physical-delete tool.

For a full issue, design, and memory sequence, follow the [cross-module workflow](/guides/issue-design-memory-workflow).
