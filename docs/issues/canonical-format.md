# Canonical issue format

A v1 YAML record contains stable `id`, `type`, `title`, `status`, timestamps, optional creator/assignee/parent, persisted `depends_on`, deterministically owned `relates_to`, directional `duplicates`/`supersedes`, body, JSON-compatible metadata, append-only comments, and typed links such as `{kind: design-doc, id: doc-01..., version: 2}`.

Parents are stored only on children. Children, `blocks`, `blocked_by`, and symmetric related views are derived. The complete active/archive graph rejects missing targets, self-links, illegal hierarchy, parent/dependency cycles, and duplicate identities. Safe manually formatted YAML may be read, but only a write canonicalizes it. A revision is SHA-256 over exact source bytes, so every manual edit invalidates stale mutation evidence.
