# @neottia/pi-issues

Native Pi extension for the 17 Issues tools.

```sh
pnpm add -D @neottia/pi-issues
```

Create `.pi/extensions/issues.ts`:

```ts
export { default } from "@neottia/pi-issues";
```

Enable `skills.issues`, restart Pi, and verify that `issue_create` appears. Calls route by invocation CWD, forward cancellation, and use Pi confirmation for stale-cache `prompt`. Cleanup clears every routed context. The default Design Docs resolver is automatic; `registerIssueTools` also accepts `resolver` and `onStaleCache`.

Read the [Pi guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/pi.md#issues) and [Issues tools](https://github.com/dragoscirjan/neottia/blob/main/docs/issues/tools.md).
