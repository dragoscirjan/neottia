# @neottia/pi-searchable

Native in-process Searchable tools for Pi.

```sh
pnpm add -D @neottia/pi-searchable
```

Enable `modules.searchable`, load the extension in Pi, and verify that the five `web_*` tools appear. The extension resolves one official shared snapshot for each invocation working directory, passes its immutable Searchable shard to the runtime and tools, forwards cancellation, asks before rebuilding a stale stash cache, and closes every routed runtime during `session_shutdown`.

Read the [Pi guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/pi.md#searchable).
