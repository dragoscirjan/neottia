# Claude Code

Neottia compiles and installs the canonical SDLC for Claude Code through [`@neottia/claude-code-adapter`](https://www.npmjs.com/package/@neottia/claude-code-adapter). The adapter declares documented Claude Code behavior and returns reviewable plans. The distribution installer writes approved assets and configuration. The adapter itself never writes files or runs the Claude Code binary.

## Tested support

The adapter projects these assets. Paths follow the [Claude Code documentation](https://code.claude.com/docs/en/overview).

| Asset             | Project                        | Global                           |
| ----------------- | ------------------------------ | -------------------------------- |
| Command           | `.claude/commands/<id>.md`     | `~/.claude/commands/<id>.md`     |
| Skill             | `.claude/skills/<id>/SKILL.md` | `~/.claude/skills/<id>/SKILL.md` |
| Agent             | `.claude/agents/<id>.md`       | `~/.claude/agents/<id>.md`       |
| MCP configuration | `.mcp.json`                    | Unsupported                      |

Command frontmatter supports `description`, `argument-hint`, `model`, and documented subagent routing. A portable subtask request maps to `context: fork`, and an explicit agent selection emits both `context: fork` and the documented `agent` field. Agent files support `name`, `description`, `model`, `effort`, and `maxTurns`. The portable per-tool permission map has no documented agent-file representation, so permission metadata returns a diagnostic instead of being dropped.

MCP plans target the committed project file `.mcp.json` under `mcpServers`. Local servers use the documented `type: "stdio"` shape with `command` and optional `args` and `env`; remote servers use `type: "http"` with `url` and optional `headers`. Per-server `timeout` values follow the documented minimum of 1000 milliseconds. The adapter does not edit user-managed state such as `~/.claude.json`, so MCP configuration is project-scoped only. Claude Code also requires interactive approval of project `.mcp.json` servers after installation.

The default Issues and Design Docs modules use exact `@neottia/issues-mcp` and `@neottia/design-docs-mcp` versions. Optional Memory and Searchable modules use their exact generic MCP packages when enabled. Each entry launches through `npx --yes --package <name>@<version> <executable>`. The package version comes from the CLI compatibility catalog, not from a registry lookup during planning.

## Unsupported and deferred support

- Claude Code plugin distribution. Neottia uses generic MCP servers for runtime tools because single-file extension requests cannot represent the multi-file plugin format.
- User-scope MCP configuration. The installer does not edit `~/.claude.json`. Global commands, skills, and agents remain available, but a lifecycle with runtime modules must use project scope.
- Codex, Kiro, GitHub Copilot CLI, and Visual Studio Code Copilot. Issue [#119](https://github.com/dragoscirjan/neottia/issues/119) keeps these harnesses deferred.

## Installation

Install Node.js 22.20 or newer, pnpm 10 or newer, and ensure `npx` is on `PATH`. Then run:

```sh
pnpm add --global @neottia/cli
neottia init --harness claude-code
neottia apply
neottia doctor
```

After installation, restart Claude Code so commands, agents, and MCP configuration load together. Open `/mcp` and approve each project server from `.mcp.json`. This approval is a Claude Code security boundary. Neottia does not bypass it. The restart recommendation is Neottia adapter policy; Claude Code reloads some resources live but does not document one reload command for every asset type.

## Authentication and configuration

Claude Code manages its own sign-in, settings files, and OAuth for remote MCP servers. Neottia plans keep Claude Code environment references such as `${ISSUES_TOKEN}` unresolved and never write authentication state. Configure host authentication separately from Neottia installation.

Repository validation proves deterministic adapter projection, compiler output, installation receipts, `.mcp.json` preservation, doctor output, and packed external-consumer installation. It does not execute a Claude Code binary in CI, so the adapter does not list a tested host version.
