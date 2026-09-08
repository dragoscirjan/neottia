# Memory

Neottia's memory module gives AI agents a durable, reviewable project memory: what the project is, what was decided, what happened, and what was learned.

Everything an agent remembers is stored as small YAML files inside the project repository — committable, diffable, and auditable like code — with a SQLite index for ranked full-text search.

## How you consume it

Memory is available in three shapes, all using the **same tool names and configuration**:

| Shape                                                                        | For                                                                          | How it is configured                      |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------- |
| **MCP server** (`@neottia/memory-mcp`)                                       | Any harness that speaks MCP: Claude Code, Codex, Copilot, Kiro, pi, OpenCode | `mcpServers` entry + `NEOTTIA_*` env vars |
| **In-process extensions** (`@neottia/pi-memory`, `@neottia/opencode-memory`) | pi and OpenCode, with host-provided prompts                                  | project `.neottia/config.yml`             |
| **Library** (`@neottia/memory-core`)                                         | Your own tools and scripts                                                   | Config file, env vars, or code            |

## The tools

| Tool                              | Purpose                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| `memory_store`                    | Save a new fact, decision, event, or lesson                  |
| `memory_supersede`                | Correct an existing memory (history is preserved)            |
| `memory_delete`                   | Retire a memory with a reason (nothing is deleted from disk) |
| `memory_get`                      | Fetch one memory by its ID                                   |
| `memory_list`                     | List memories, newest first                                  |
| `memory_search`                   | Ranked full-text search                                      |
| `memory_validate`                 | Verify canonical files and the search index                  |
| `memory_export` / `memory_import` | Move memory between projects (JSONL)                         |

## Pages

- [Enabling and configuring memory](./configuration.md)
- [Wiring the MCP server into any harness](./mcp-server.md)
- [Records, lifecycle, and storage](./records.md)
- [The tool contract](./tools.md)
- [Security, limits, and concurrency](./operations.md)
- [Troubleshooting](./operations.md#troubleshooting)

## A 60-second tour

1. Enable memory in `.neottia/config.yml`:

   ```yaml
   version: 1
   skills:
     memory:
       enabled: true
   ```

2. Ask your agent: _"remember that this project deploys with pnpm, never npm"_ — it calls `memory_store` with a `semantic`/`fact` record.

3. Later, ask _"how does deployment work here?"_ — it calls `memory_search`, gets the ranked answer, and reads the YAML file if it wants the full audit trail.

4. The file sits in `.neottia/memory/facts/`, ready to be committed:

   ```yaml
   id: 01J8Z0V1A2B3C4D5E6G7H8J9K0
   summary: This project deploys with pnpm, never npm
   memory_type: semantic
   record_type: fact
   created_by: agent:pi
   confidence: confirmed
   # ...provenance and tags
   ```

## Where to go next

- Configure namespaces, cache behavior, and env overrides: [Configuration](./configuration.md)
- Understand supersession, tombstones, and the on-disk format: [Records and storage](./records.md)
- Wire the MCP server into any harness: [Tool contract](./tools.md)
- Understand secret scanning, limits, and locking: [Operations](./operations.md)
