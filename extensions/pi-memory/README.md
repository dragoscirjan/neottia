# @neottia/pi-memory

Native Pi extension for the nine Memory tools.

```sh
pnpm add -D @neottia/pi-memory
```

Create `.pi/extensions/memory.ts`:

```ts
export { default } from "@neottia/pi-memory";
```

Enable `skills.memory` in `.neottia/config.yml`, restart Pi, and verify that `memory_store` appears. Memory fixes CWD at registration, asks before a stale-cache rebuild when Pi provides `ui.confirm`, and currently ignores call cancellation. Keep and await the cleanup returned by `registerMemoryTools`; the default entry does this on session shutdown.

Read the [Pi guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/pi.md#memory) and [Memory tools](https://github.com/dragoscirjan/neottia/blob/main/docs/memory/tools.md).
