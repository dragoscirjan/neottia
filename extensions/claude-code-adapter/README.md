# @neottia/claude-code-adapter

`@neottia/claude-code-adapter` projects Neottia commands, Agent Skills, custom agents, and project MCP configuration for Claude Code. It implements `HarnessAdapter` from `@neottia/harness-adapter` and does not read files, write files, run commands, or authenticate MCP servers.

## Install

```sh
pnpm add @neottia/claude-code-adapter @neottia/harness-adapter
```

## Use

```ts
import { claudeCodeHarnessAdapter } from "@neottia/claude-code-adapter";

claudeCodeHarnessAdapter.planHostConfiguration({
  kind: "mcp.local",
  scope: "project",
  server: {
    name: "neottia-issues",
    command: ["node", "issues-server.js"],
  },
});
```

The adapter returns an operation for `.mcp.json#/mcpServers`. The distribution package applies that operation only after review and preserves unrelated server entries.

## Paths

Project assets use these paths:

- commands: `.claude/commands/<id>.md`
- skills: `.claude/skills/<id>/SKILL.md`
- agents: `.claude/agents/<id>.md`
- MCP configuration: `.mcp.json`

Global commands, skills, and agents use the same directories under `~/.claude`. The adapter does not edit `~/.claude.json`, so MCP plans support project scope only.

## Limits

Claude Code plugins require directories with manifests and components. The shared extension request contains one TypeScript source file, so the adapter rejects extension projection instead of inventing a plugin package. Neottia does not publish Claude Code runtime plugins, so package activation is also unsupported.

Command projection supports description, argument hint, and model metadata. Custom agents support model, effort, and maximum turns. The portable per-tool `allow`, `ask`, and `deny` map has no exact Claude Code agent-file representation, so permission metadata returns a diagnostic.

The declaration leaves `testedHostVersions` empty. Repository tests cover deterministic paths, frontmatter, MCP operation shapes, shared adapter conformance, and SDLC compilation without executing a Claude Code binary.

See the [Claude Code setup guide](../../docs/harnesses/claude-code.md) and [adapter contract](../../docs/harnesses/adapters.md).
