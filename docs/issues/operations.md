# Search, concurrency, and recovery

`issue_search` uses a domain-owned SQLite FTS5 index and BM25 ranking across title, body, comments, and scalar metadata. Exact status/type/assignee/parent/location filters are applied. Candidate IDs and revisions are always hydrated from canonical YAML; cache content never becomes returned authority. Missing, corrupt, wrong-version, stale, or contradictory caches rebuild from a valid complete YAML snapshot.

All writes hold the repository authority lease, validate a complete proposed graph, and publish through a durable exact-revision batch. Recursive archive/restore moves the complete subtree. On the next lease acquisition repository-store recovers interrupted journals without overwriting operator changes. Resolve conflicts by inspecting Git and canonical YAML, then retry with the latest returned revision. Symlinks, hard links, special files, unsafe paths, portable path collisions, and configured resource-limit violations fail closed.
