# @neottia/opencode-issues

OpenCode plugin exposing the seventeen canonical Neottia issue tools in-process. Add the package to OpenCode's `plugin` array and enable `skills.issues` in `.neottia/config.yml`. Calls use the active worktree and generated core Zod schemas. When both capabilities are enabled, the default plugin validates typed design-document links through `@neottia/issues-design-docs`; use `createIssuesPlugin({resolver})` to replace that resolver. Explicit `fail` cache policy is preserved.
