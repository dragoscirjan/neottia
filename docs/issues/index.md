# Issues

Issues stores one work item per canonical YAML file. It supports hierarchy, dependencies, relationships, comments, typed Design Docs links, search, archive and restore, and migrations.

Check [requirements](/get-started/requirements), then choose the [library](/issues/library), [Pi](/harnesses/pi#issues), [OpenCode](/harnesses/opencode#issues), or [generic MCP server](/mcp/issues).

- [Configure Issues](/issues/configuration)
- [Read the canonical format](/issues/canonical-format)
- [Run lifecycle operations](/issues/lifecycle)
- [Model relationships](/issues/relationships)
- [Call all 17 tools](/issues/tools)
- [Compose with Design Docs](/issues/design-docs)
- [Migrate data](/issues/migration)
- [Operate and troubleshoot](/issues/operations)

Enable the canonical shared shard:

```yaml
version: 1
modules:
  issues:
    enabled: true
```

Install `@neottia/issues` for library access, `@neottia/issues-mcp` for generic stdio MCP, or `@neottia/pi-issues` / `@neottia/opencode-issues` for direct harness tools. The package exports `issueConfigContribution` for shared `@neottia/config` snapshots and keeps `loadIssueConfig()` for standalone compatibility.

Track `.neottia/issues/**/*.yml`. Ignore `.neottia/cache/issues.sqlite` as described in [Repository files](/guides/repository-files).
