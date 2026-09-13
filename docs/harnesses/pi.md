# Pi extensions

Install the self-describing Pi packages in the project where Pi runs:

```sh
pi install -l npm:@neottia/pi-memory
pi install -l npm:@neottia/pi-issues
pi install -l npm:@neottia/pi-design-docs
pi install -l npm:@neottia/pi-searchable
```

Each package declares its extension entry point through `pi.extensions`. Pi records project packages in `.pi/settings.json` and installs missing packages after the project is trusted. Enable `modules.memory`, `modules.issues`, `modules.design_docs`, and `modules.searchable` in `.neottia/config.yml`. Restart Pi, then inspect its tool list for 9 `memory_*`, 17 `issue_*`, 13 `document_*`, and 5 `web_*` tools. Use the calls in [First success](/get-started/first-success) to verify each capability.

Generated installers can use [`@neottia/pi-adapter`](/harnesses/adapters) to plan package entries and resource paths without hard-coding Pi paths.

## Memory

`@neottia/pi-memory` fixes the project directory when `registerMemoryTools` runs. Pi can confirm stale-cache rebuilds through `ui.confirm`. The extension currently ignores the call abort signal. Its returned cleanup closes the Memory backend, and the default entry registers cleanup on `session_shutdown`.

See [Memory configuration](/memory/configuration) and [Memory tools](/memory/tools).

## Issues

`@neottia/pi-issues` resolves `invocation.cwd` for every call and caches a context per directory. It forwards cancellation and can confirm stale-cache rebuilds. Cleanup clears every routed context.

The default resolver comes from `@neottia/issues-design-docs`. Embedders may pass `resolver` to `registerIssueTools`. See [Issues configuration](/issues/configuration), [tools](/issues/tools), and [composition](/issues/design-docs).

## Searchable

`@neottia/pi-searchable` resolves an official shared snapshot for every `invocation.cwd`, owns one runtime and immutable Searchable shard per directory, and forwards cancellation. Pi can confirm a stale-cache rebuild through `ui.confirm`. Cleanup closes every routed runtime during `session_shutdown`.

See [Searchable configuration](/searchable/configuration), [tools](/searchable/tools), and [operations](/searchable/operations).

## Design Docs

`@neottia/pi-design-docs` resolves `invocation.cwd` per call and forwards cancellation. Pi asks before review and approval transitions unless the caller supplies `confirmTransition`. It can also ask before stale-cache rebuilds. Cleanup clears routed contexts.

The default link validator comes from `@neottia/issues-design-docs`. Embedders may pass `linkValidator` to `registerDesignDocsTools`. See [Design Docs configuration](/design-docs/configuration), [tools](/design-docs/tools), and [composition](/issues/design-docs).

If tools are absent, run `pi list`, confirm that the package is present in project settings, and restart Pi. Local source extensions still belong under `.pi/extensions/`. If a call reports a disabled capability, enable the matching shard in the call's project directory.
