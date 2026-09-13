# @neottia/pi-searchable

Native in-process Searchable tools for Pi.

```sh
pnpm add -D @neottia/pi-searchable
```

Enable `skills.searchable`, load the extension in Pi, and verify that the five `web_*` tools appear. The extension routes each call by invocation working directory, forwards cancellation, asks before rebuilding a stale stash cache, and closes every routed runtime during `session_shutdown`.

Read the [Pi guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/pi.md#searchable).
