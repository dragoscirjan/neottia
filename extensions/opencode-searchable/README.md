# @neottia/opencode-searchable

Native in-process Searchable tools for OpenCode.

```sh
pnpm add -D @neottia/opencode-searchable
```

Add `"@neottia/opencode-searchable"` to the OpenCode `plugin` array, enable `modules.searchable`, restart OpenCode, and verify that the five `web_*` tools appear. The plugin resolves one official shared snapshot for the project directory, passes its immutable Searchable shard to the runtime and tools, forwards invocation cancellation, rebuilds stale caches without prompting, and closes its runtime on `dispose`.

Read the [OpenCode guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/opencode.md#searchable).
