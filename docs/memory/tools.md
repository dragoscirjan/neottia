# The tool contract

Memory is exposed as **named tools** so an agent can call it without knowing anything about the implementation. The names, descriptions, and input contracts are identical across every surface: the MCP server, the pi and OpenCode extensions, and the library's tool layer.

## Wiring the MCP server

Add `@neottia/memory-mcp` to any harness that supports MCP:

```json
{
  "mcpServers": {
    "memory": {
      "command": "pnpm",
      "args": ["dlx", "@neottia/memory-mcp"],
      "env": {
        "NEOTTIA_MEMORY_ENABLED": "true",
        "NEOTTIA_MEMORY_NAMESPACE_ORGANIZATION_ID": "acme",
        "NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID": "website",
        "NEOTTIA_MEMORY_CACHE_STALE_POLICY": "rebuild"
      }
    }
  }
}
```

The server resolves configuration from the working directory of the harness (`.neottia/config.yml`) plus the environment above. It is **non-interactive**: a `stale_policy` of `prompt` is downgraded to `rebuild`; an explicit `fail` is respected.

## The tools

| Tool               | Input (essentials)                                                                                                                            | Returns                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `memory_store`     | `memory_type`, `record_type`, `summary`, `source {kind, ref, revision}`, `created_by`, `confidence`, plus optional `topic`, `details`, `tags` | The stored record, including its generated ID          |
| `memory_supersede` | Everything `memory_store` takes, plus `target_id` (must be active)                                                                            | The replacement record                                 |
| `memory_delete`    | `target_id`, `reason`, `source`, `created_by`                                                                                                 | The tombstone                                          |
| `memory_get`       | `id` (ULID)                                                                                                                                   | The record or tombstone                                |
| `memory_list`      | optional `topic`, `memory_type`, `limit`, `include_superseded`                                                                                | Records, newest first                                  |
| `memory_search`    | `query` (required), optional `topic`, `memory_type`, `limit`, `max_chars`, `include_superseded`                                               | BM25-ranked records within the character budget        |
| `memory_validate`  | none                                                                                                                                          | `{ valid, records, tombstones, errors, cache }` report |
| `memory_export`    | none                                                                                                                                          | JSONL text of every record and tombstone               |
| `memory_import`    | `content` (JSONL), optional `preview: true`                                                                                                   | `{ valid, records, tombstones, errors }`               |

> The packaged way to expose these tools to any harness is the [`@neottia/memory-mcp`](./mcp-server) server — with per-harness wiring examples for Claude Code, OpenCode, pi, Codex, Kiro, and VS Code.

Errors are returned as tool errors with a human-readable message (for example `Memory record not found: …`, `summary has 241 Unicode characters; limit is 240`, `Suspected secret at $.summary`).

## Input validation

Every tool input is validated by a Zod schema before it reaches the store:

- unknown keys are rejected,
- IDs must be Crockford ULIDs,
- enums are enforced (`memory_type`, `record_type`, `confidence`, `source.kind`),
- numeric ranges are enforced (`limit` 1–100, `max_chars` 256–100000),
- mutation text is compact (`summary` max 240 Unicode characters; `details` max 2000 characters and 12 non-empty lines),
- query and import payloads are bounded at 16 KiB and 64 MiB respectively.

The same schemas generate the `tools/list` JSON Schema that MCP clients display, so what a client sees is exactly what the store accepts.

## Calling conventions for agents

- Store **small, atomic** knowledge: one fact per record, ≤ 240 characters of summary. Use `details` for at most a dozen lines of supporting context.
- Always set `source.kind` honestly: `user-confirmed` when a human stated it, `tool-observation` when an agent verified it, `artifact` when it was read from the repository. `verified` confidence is only valid for the latter two.
- Prefer `memory_supersede` over `memory_delete` when the old memory still has historical value.
- Use `topic` deliberately (for example `tooling`, `deployment`, `architecture`); it is the primary filter agents use to scope recall.
- After storing something important, a follow-up `memory_search` confirms visibility.
