# @neottia/opencode-issues

OpenCode plugin exposing the seventeen canonical Neottia issue tools in-process. Add the package to OpenCode's `plugin` array and enable `skills.issues` in `.neottia/config.yml`. Calls use the active worktree and generated core Zod schemas. Use `createIssuesPlugin({resolver})` when composing typed design-document validation; explicit `fail` cache policy is preserved.
