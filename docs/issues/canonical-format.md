# Canonical issue format

Active records live at `.neottia/issues/<id>.yml`; archived records live below `.neottia/issues/archive/`. New IDs use the configured prefix plus an uppercase Crockford ULID.

```yaml
version: 1
id: issue-01JQ2Z7Y6T9W8V5R4S3N2M1K0H
type: story
title: Add a deployment status page
status: in_progress
created_at: 2025-01-15T12:00:00.000Z
updated_at: 2025-01-16T09:30:00.000Z
created_by: user:owner
assigned_to: agent:pi
parent: issue-01JQ2Y00000000000000000000
depends_on:
  - issue-01JQ2X00000000000000000000
relates_to:
  - issue-01JQ2W00000000000000000000
duplicates: []
supersedes: []
body: Add health and deployment details.
metadata:
  component: website
comments:
  - id: comment-01JQ3000000000000000000000
    author: user:owner
    body: Include the current release version.
    created_at: 2025-01-16T09:30:00.000Z
links:
  - kind: design-doc
    id: doc-01JQ2Z7Y6T9W8V5R4S3N2M1K0H
    version: 1
```

Types are `initiative`, `epic`, `story`, `task`, and `bug`. Statuses are `open`, `in_progress`, `done`, and `closed`. Comments are append-only. Metadata values must be JSON-compatible.

Children, `blocks`, `blocked_by`, and symmetric related views are derived and never stored. For `relates_to`, only the lexically smaller issue ID stores the edge. The [relationship contract](/issues/relationships) covers ownership, hierarchy, cycle, target, and duplicate-edge validation across the complete active and archived graph.

A revision is `v1:<sha256-of-exact-bytes>`. Mutations that require `expected_revision` reject stale revisions as described in the [lifecycle guide](/issues/lifecycle). When a requested mutation is a semantic no-op, Neottia still validates the graph and repairs safe noncanonical YAML. The issue meaning and `updated_at` stay unchanged, while canonical bytes—and therefore the revision—may change.
