# @neottia/pi-issues

Native Pi extension for the 17 Issues tools.

```sh
pnpm add -D @neottia/pi-issues
```

Create `.pi/extensions/issues.ts`:

```ts
export { default } from "@neottia/pi-issues";
```

Enable `modules.issues` in `.neottia/config.yml`, restart Pi, and verify that `issue_create` appears. The deprecated `skills.issues` path remains available during migration.

Calls route by invocation CWD, forward cancellation, and use Pi confirmation for stale-cache `prompt`. Cleanup clears every routed context. When Issues and Design Docs are enabled, the default extension validates typed document links through `@neottia/issues-design-docs`. `registerIssueTools` also accepts `resolver` and `onStaleCache` overrides.

Read the [Pi guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/pi.md#issues), [Issues tools](https://github.com/dragoscirjan/neottia/blob/main/docs/issues/tools.md), and [unified configuration guide](../../docs/configuration.md).
