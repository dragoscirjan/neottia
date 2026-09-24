---
'@neottia/sdlc': minor
---

Add the shared Epic-first operating protocol. Compilation now resolves the packaged `neottia.sdlc.protocol` template, carries it as a checksummed `protocol` field in compiler input (schema version 4), and projects one `neottia-sdlc` skill through every adapter. The protocol defines one-owning-Epic resolution, append-only durable checkpoints (`neottia-sdlc:checkpoint`), explicit action-scoped approvals, per-command procedures for Plan, Build, Verify, Release, Continue, and Refresh, and strict handback rules. Override the body via template layers at `.neottia/templates/sdlc/protocol.md`.
