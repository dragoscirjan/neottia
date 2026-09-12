# Pi extensions

Install the packages in the project where Pi runs:

```sh
pnpm add -D @neottia/pi-memory @neottia/pi-issues @neottia/pi-design-docs
```

Create project-local extension entry files. For example, `.pi/extensions/memory.ts` contains:

```ts
export { default } from "@neottia/pi-memory";
```

Create equivalent files for `@neottia/pi-issues` and `@neottia/pi-design-docs`. Enable `skills.memory`, `skills.issues`, and `skills.design_docs` in `.neottia/config.yml`. Restart Pi, then inspect its tool list for 9 `memory_*`, 17 `issue_*`, and 13 `document_*` tools. Use the calls in [First success](/get-started/first-success) to verify each capability.

## Memory

`@neottia/pi-memory` fixes the project directory when `registerMemoryTools` runs. Pi can confirm stale-cache rebuilds through `ui.confirm`. The extension currently ignores the call abort signal. Its returned cleanup closes the Memory backend, and the default entry registers cleanup on `session_shutdown`.

See [Memory configuration](/memory/configuration) and [Memory tools](/memory/tools).

## Issues

`@neottia/pi-issues` resolves `invocation.cwd` for every call and caches a context per directory. It forwards cancellation and can confirm stale-cache rebuilds. Cleanup clears every routed context.

The default resolver comes from `@neottia/issues-design-docs`. Embedders may pass `resolver` to `registerIssueTools`. See [Issues configuration](/issues/configuration), [tools](/issues/tools), and [composition](/issues/design-docs).

## Design Docs

`@neottia/pi-design-docs` resolves `invocation.cwd` per call and forwards cancellation. Pi asks before review and approval transitions unless the caller supplies `confirmTransition`. It can also ask before stale-cache rebuilds. Cleanup clears routed contexts.

The default link validator comes from `@neottia/issues-design-docs`. Embedders may pass `linkValidator` to `registerDesignDocsTools`. See [Design Docs configuration](/design-docs/configuration), [tools](/design-docs/tools), and [composition](/issues/design-docs).

If tools are absent, confirm that the files are under the project's `.pi/extensions/` directory and restart Pi. If a call reports a disabled capability, enable the matching shard in the call's project directory.
