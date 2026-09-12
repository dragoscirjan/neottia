# @neottia/opencode-issues

Native OpenCode plugin for the 17 Issues tools.

```sh
pnpm add -D @neottia/opencode-issues
```

Add `"@neottia/opencode-issues"` to the OpenCode `plugin` array, enable `skills.issues`, restart OpenCode, and verify that `issue_create` appears. The plugin uses `host.directory`, forwards an `AbortSignal`, uses non-interactive cache handling, and clears context on `dispose`. `createIssuesPlugin({resolver})` replaces the automatic Design Docs resolver.

Read the [OpenCode guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/opencode.md#issues) and [Issues tools](https://github.com/dragoscirjan/neottia/blob/main/docs/issues/tools.md).
