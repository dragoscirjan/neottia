# Canonical Design Docs format

Active documents live below `.neottia/design-docs/`; archived lineages live below its `archive/` directory. New IDs are `doc-` plus an uppercase Crockford ULID. Legacy `doc-00001` IDs remain readable but are not allocated. A filename is `<id>-<title-slug>-v<N>.md`.

A canonical file has bounded YAML frontmatter, UTF-8 text with LF endings, one matching H1, and a blank line after the H1:

```md
---
id: doc-01JQ2Z7Y6T9W8V5R4S3N2M1K0H
title: Deployment status page
kind: hld
status: draft
version: 1
created_at: 2025-01-15T12:00:00.000Z
updated_at: 2025-01-15T12:00:00.000Z
created_by: user:owner
metadata:
  issue: deployment-status
---

# Deployment status page

Describe the data source and update interval.
```

Kinds are `hld`, `lld`, `design-overview`, and `gdd`. Statuses are `draft`, `review`, and `approved`. Frontmatter accepts only the shown identity, lifecycle, creator, and JSON-compatible metadata fields. YAML aliases, anchors, tags, directives, unknown fields, controls, a second H1, and configured limit violations fail validation.

A revision is `v1:<sha256-of-exact-file-bytes>`. Carry the returned revision into every mutation. Stable identity is the document ID plus an optional version, never the path.
