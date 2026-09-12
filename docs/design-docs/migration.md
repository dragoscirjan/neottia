# Design Docs migration

`document_export` emits a deterministic, digested bundle with exact canonical bytes. Keep canonical Markdown in Git as the raw backup; the export is the validated portable representation.

`document_import` supports native and explicit `harnessctl-v2` bundles. It defaults to preview and reports additions, conflicts, unsupported records, warnings, and path mappings. Inspect the report, resolve every conflict, then call it again with `preview: false`. Publication validates the complete proposed state before one recoverable batch.

A harnessctl bundle has `version: 1`, `format: "harnessctl-v2-design-documents"`, and document entries containing `path`, `content`, and optional `location`. The package never scans or mutates `.harnessctl/documents` or `.specs` automatically.

Do not back up `.neottia/cache/design-docs.sqlite` or repository-store control files. See [backup and migration](/guides/backup-and-migration).
