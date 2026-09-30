---
"@neottia/memory-core": minor
"@neottia/memory-mcp": minor
"@neottia/pi-memory": minor
"@neottia/opencode-memory": minor
---

Propagate host cancellation through Memory: the pi tool call signal, the OpenCode invocation abort, and the MCP request signal now flow into every `memory_*` tool, and `MemoryStore`/backend operations accept a `MemoryOperationControl` (`{ signal, deadline }`). Already-aborted calls reject with the stable `MemoryCancellationError` (`ABORTED` / `DEADLINE_EXCEEDED`) before any backend, lease, or cache work; cancellation is checked at safe phase boundaries while the atomic publication batch and post-commit cache maintenance remain non-interruptible. Adds Pi, OpenCode, and MCP cancellation contract tests plus representative filesystem/PostgreSQL coverage.
