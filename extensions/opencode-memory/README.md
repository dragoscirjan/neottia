# @neottia/opencode-memory

Native OpenCode plugin for the nine Memory tools.

```sh
pnpm add -D @neottia/opencode-memory
```

Add `"@neottia/opencode-memory"` to the OpenCode `plugin` array, enable `skills.memory`, restart OpenCode, and verify that `memory_store` appears. The plugin uses `ctx.directory`, rebuilds stale caches for `prompt`, currently ignores abort signals, and closes Memory on `dispose`.

Read the [OpenCode guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/opencode.md#memory) and [Memory tools](https://github.com/dragoscirjan/neottia/blob/main/docs/memory/tools.md).
