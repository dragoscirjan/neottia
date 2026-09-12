# @neottia/opencode-issues

Native OpenCode plugin for the 17 Issues tools.

```sh
pnpm add -D @neottia/opencode-issues
```

Add `"@neottia/opencode-issues"` to the OpenCode `plugin` array, enable `modules.issues` in `.neottia/config.yml`, restart OpenCode, and verify that `issue_create` appears. The deprecated `skills.issues` path remains available during migration.

The plugin uses `host.directory`, forwards an `AbortSignal`, applies non-interactive cache handling, and clears its context on `dispose`. When Issues and Design Docs are enabled, the default plugin validates typed document links through `@neottia/issues-design-docs`. `createIssuesPlugin({resolver})` replaces that resolver. An explicit `fail` cache policy remains unchanged.

Read the [OpenCode guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/opencode.md#issues), [Issues tools](https://github.com/dragoscirjan/neottia/blob/main/docs/issues/tools.md), and [unified configuration guide](../../docs/configuration.md).
