# @neottia/opencode-adapter

`@neottia/opencode-adapter` projects Neottia assets and configuration plans for OpenCode. It implements `HarnessAdapter` from `@neottia/harness-adapter` and performs no filesystem or process operations.

## Install

```sh
pnpm add @neottia/harness-adapter @neottia/opencode-adapter
```

## Use

```ts
import { opencodeHarnessAdapter } from "@neottia/opencode-adapter";

opencodeHarnessAdapter.planHostConfiguration({
  kind: "mcp.local",
  scope: "project",
  server: {
    name: "neottia-issues",
    command: ["node", "issues-server.js"],
    enabled: true,
  },
});
```

Project assets use `.opencode/commands`, `.opencode/skills`, `.opencode/plugins`, and `.opencode/agents`. Global assets use the same plural directories under the symbolic `xdg-config/opencode` target. Configuration plans target existing `opencode.json` or `opencode.jsonc`, and create `opencode.json` only when neither exists.

See the [harness adapter guide](../../docs/harnesses/adapters.md) for the shared contract and complete feature matrix.

The adapter supports npm plugin entries, local and remote MCP entries, and native agent Markdown. It keeps MCP commands as argument arrays and leaves environment references unchanged. It never creates authentication files.

OpenCode command metadata supports `description`, `agent`, `model`, and `subtask`. Native agents support mode, model, permissions, and steps. The documented command format has no argument hint, so that request produces a diagnostic. The adapter recommends a restart for deterministic pickup. This is Neottia adapter policy because OpenCode does not document one universal reload contract.

The declaration does not list a tested OpenCode version because repository validation does not execute an OpenCode binary.
