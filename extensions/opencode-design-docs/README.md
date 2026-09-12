# @neottia/opencode-design-docs

Native OpenCode plugin for the 13 Design Docs tools.

```sh
pnpm add -D @neottia/opencode-design-docs
```

Add `"@neottia/opencode-design-docs"` to the OpenCode `plugin` array, enable `skills.design_docs`, restart OpenCode, and verify that `document_create` appears. Calls use their directory or fall back to the plugin directory, forward abort, and use non-interactive cache handling. `dispose` clears context. `createDesignDocsPlugin({linkValidator})` replaces the automatic Issues validator.

Read the [OpenCode guide](https://github.com/dragoscirjan/neottia/blob/main/docs/harnesses/opencode.md#design-docs) and [Design Docs tools](https://github.com/dragoscirjan/neottia/blob/main/docs/design-docs/tools.md).
