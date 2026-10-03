---
"@neottia/sdlc": minor
"@neottia/cli": minor
"@neottia/config-registry": minor
---

Integrate Memory as an optional SDLC lifecycle capability (#181). The compiler gains a `capabilities.memory` contribution (`none` | `filesystem` | `postgres`, default `none`) with fail-closed semantics: a non-`none` selection requires `modules.memory.enabled` and must match the Memory module's own backend, and the published configuration schema covers the new shard. When enabled, every compiled lifecycle command renders durable-memory boundaries — read-only retrieval before planning or resuming work, checkpoint evidence recorded through the `memory_*` authority with exact ownership and revision evidence, and a durable outcome summary before a lifecycle run stops; memory never authorizes mutation or bypasses the issue and document authorities. The CLI initializer gains `--enable memory`, which writes the module enablement and the matching capability provider while keeping Memory disabled by default.
