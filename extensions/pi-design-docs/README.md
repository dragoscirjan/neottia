# @neottia/pi-design-docs

Native Pi extension for the 13 Design Docs tools.

```sh
pnpm add -D @neottia/pi-design-docs
```

Create `.pi/extensions/design-docs.ts`:

```ts
export { default } from "@neottia/pi-design-docs";
```

Enable `skills.design_docs`, restart Pi, and verify that `document_create` appears. Calls route by invocation CWD and forward cancellation. Pi may confirm stale-cache rebuilds and transitions to review or approved. Cleanup clears every routed context. The default Issues validator is automatic; `registerDesignDocsTools` accepts `linkValidator`, `onStaleCache`, and `confirmTransition`.

Read the [Pi guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/pi.md#design-docs) and [Design Docs tools](https://github.com/dragoscirjan/neottia/blob/main/docs/design-docs/tools.md).
