# Migration and troubleshooting

Use `issue_export` for a deterministic native backup. Pass that content to `issue_import`; `preview` defaults to `true`, validates the complete proposed graph, and writes nothing. Set `preview: false` only after reviewing collisions and diagnostics.

A single harnessctl-v2 YAML record can be previewed explicitly. Decimal IDs and supported fields/comments/relations are preserved. Legacy `documents: [path]` cannot be accepted as stable identity without an explicit resolver mapping and is reported as ambiguous; Neottia never scans `.harnessctl/issues` automatically.

If validation fails, correct or restore canonical YAML from Git and run `issue_validate`. Delete `.neottia/cache/issues.sqlite*` to force safe cache reconstruction. Do not delete `.neottia/repository-store` while an operation is active; it contains authority and recovery state.
