# Issues

Neottia Issues stores one issue per Git-trackable YAML file. Enable it in `.neottia/config.yml`:

```yaml
version: 1
skills:
  issues:
    enabled: true
```

Install `@neottia/issues` for library access, `@neottia/issues-mcp` for generic stdio MCP, or `@neottia/pi-issues` / `@neottia/opencode-issues` for direct harness tools.

New IDs are `issue-` plus an uppercase Crockford ULID. Active files live in `.neottia/issues/`; archived files live in `.neottia/issues/archive/`. Track those YAML files in Git. The SQLite search cache under `.neottia/cache/` is disposable and should remain ignored.

Start with [configuration](configuration), then see the [canonical format](canonical-format), [tool reference](tools), [search and operations](operations), and [migration guide](migration).
