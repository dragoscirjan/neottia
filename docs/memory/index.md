# Memory

Memory stores small facts, decisions, events, and lessons for a project. The filesystem backend uses canonical YAML and a disposable SQLite index. The PostgreSQL backend stores records under an organization, project, topic, and scope namespace.

Check [requirements](/get-started/requirements), then choose the [library](/memory/library), [Pi](/harnesses/pi#memory), [OpenCode](/harnesses/opencode#memory), or [generic MCP server](/mcp/memory).

- [Configure Memory](/memory/configuration)
- [Understand records and lifecycle](/memory/records)
- [Choose a backend](/memory/backends)
- [Call all nine tools](/memory/tools)
- [Import and export](/memory/import-export)
- [Operate and troubleshoot](/memory/operations)

Enable the canonical shared shard in the project configuration:

```yaml
version: 1
modules:
  memory:
    enabled: true
```

Track filesystem YAML and ignore the cache as described in [Repository files](/guides/repository-files).
