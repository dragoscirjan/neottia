# OpenCode extensions

Install the native plugins in your project:

```sh
pnpm add -D @neottia/opencode-memory @neottia/opencode-issues @neottia/opencode-design-docs
```

Add them to the OpenCode configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@neottia/opencode-memory", "@neottia/opencode-issues", "@neottia/opencode-design-docs"]
}
```

Enable the matching shards in `.neottia/config.yml`. Restart OpenCode and check for 9 `memory_*`, 17 `issue_*`, and 13 `document_*` tools. Run the calls in [First success](/get-started/first-success).

## Memory

`@neottia/opencode-memory` uses the plugin `ctx.directory`. It has no interactive confirmation API, so stale `prompt` policy rebuilds. Its executor currently ignores abort signals. `dispose` closes the Memory backend.

## Issues

`@neottia/opencode-issues` uses `host.directory`, forwards `invocation.abort` when it is an `AbortSignal`, and clears its context on `dispose`. It uses a non-interactive cache policy. `createIssuesPlugin({resolver})` replaces the default Issues and Design Docs composition.

## Design Docs

`@neottia/opencode-design-docs` uses the call directory when supplied and otherwise uses the plugin directory. It forwards `abort`, caches default validators by directory, and clears the tool context on `dispose`. It does not add a host confirmation before review or approval. `createDesignDocsPlugin({linkValidator})` replaces the default composition seam.

Read the [Memory](/memory/tools), [Issues](/issues/tools), and [Design Docs](/design-docs/tools) contracts. If a project routes to the wrong data, inspect the host or invocation directory rather than changing a canonical root to an absolute shared path.
