# OpenCode extensions

Install the native plugins in your project:

```sh
pnpm add -D @neottia/opencode-memory @neottia/opencode-issues @neottia/opencode-design-docs @neottia/opencode-searchable
```

Add them to the OpenCode configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "@neottia/opencode-memory",
    "@neottia/opencode-issues",
    "@neottia/opencode-design-docs",
    "@neottia/opencode-searchable"
  ]
}
```

Enable the matching `modules.*` shards in `.neottia/config.yml`. Restart OpenCode and check for 9 `memory_*`, 17 `issue_*`, and 13 `document_*`, and 5 `web_*` tools. Run the calls in [First success](/get-started/first-success).

## Memory

`@neottia/opencode-memory` uses the plugin `ctx.directory`. It has no interactive confirmation API, so stale `prompt` policy rebuilds. Its executor currently ignores abort signals. `dispose` closes the Memory backend.

## Issues

`@neottia/opencode-issues` uses `host.directory`, forwards `invocation.abort` when it is an `AbortSignal`, and clears its context on `dispose`. It uses a non-interactive cache policy. `createIssuesPlugin({resolver})` replaces the default Issues and Design Docs composition.

## Searchable

`@neottia/opencode-searchable` resolves one official shared snapshot for `host.directory`, passes its immutable Searchable shard to the runtime and tools, forwards `invocation.abort` when it is an `AbortSignal`, and closes its runtime on `dispose`. Its non-interactive cache policy rebuilds when `stale_policy` is `prompt`.

See [Searchable configuration](/searchable/configuration), [tools](/searchable/tools), and [operations](/searchable/operations).

## Design Docs

`@neottia/opencode-design-docs` uses the call directory when supplied and otherwise uses the plugin directory. It forwards `abort`, caches default validators by directory, and clears the tool context on `dispose`. It does not add a host confirmation before review or approval. `createDesignDocsPlugin({linkValidator})` replaces the default composition seam.

Read the [Memory](/memory/tools), [Issues](/issues/tools), [Design Docs](/design-docs/tools), and [Searchable](/searchable/tools) contracts. If a project routes to the wrong data, inspect the host or invocation directory rather than changing a canonical root to an absolute shared path.
