# Design Docs operations

Search uses `.neottia/cache/design-docs.sqlite`. The cache rebuilds only from valid canonical Markdown when missing, corrupt, incompatible, stale, or contradictory. Under `stale_policy: fail`, run `document_validate`; Pi may ask before rebuilding, while OpenCode and MCP rebuild for `prompt`.

Repository Store leases serialize readers and writers. Exact revisions reject stale updates. Durable journals recover interrupted multi-file publication on the next lease. Symlinks, hard links, portable path collisions, lineage gaps or splits, and modified recovery artifacts fail closed.

For a stale revision, fetch the current document and apply the change intentionally. For contention, inspect the current lease owner and retry after it exits. Preserve recovery evidence before manual intervention. If output exceeds `max_result_bytes`, narrow a list or search; a completed mutation is not rolled back merely because its response exceeds the output limit.

See [upgrade and recovery runbooks](/guides/upgrades-and-recovery) and [security and errors](/guides/security-and-errors).
