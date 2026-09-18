# Claude Code

Neottia compiles the canonical SDLC for Claude Code through [`@neottia/claude-code-adapter`](https://www.npmjs.com/package/@neottia/claude-code-adapter). The adapter declares documented Claude Code behavior and returns reviewable plans. It never writes files or runs the Claude Code binary.

## Tested support

The adapter projects these assets. Paths follow the [Claude Code documentation](https://docs.claude.com/en/docs/claude-code/overview).

| Asset             | Project                        | Global                           |
| ----------------- | ------------------------------ | -------------------------------- |
| Command           | `.claude/commands/<id>.md`     | `~/.claude/commands/<id>.md`     |
| Skill             | `.claude/skills/<id>/SKILL.md` | `~/.claude/skills/<id>/SKILL.md` |
| Agent             | `.claude/agents/<id>.md`       | `~/.claude/agents/<id>.md`       |
| MCP configuration | `.mcp.json`                    | Unsupported                      |

Command frontmatter supports `description`, `argument-hint`, `model`, and documented subagent routing. A portable subtask request maps to `context: fork`, and an explicit agent selection emits both `context: fork` and the documented `agent` field. Agent files support `name`, `description`, `model`, `effort`, and `maxTurns`. The portable per-tool permission map has no documented agent-file representation, so permission metadata returns a diagnostic instead of being dropped.

MCP plans target the committed project file `.mcp.json` under `mcpServers`. Local servers use the documented `type: "stdio"` shape with `command` and optional `args` and `env`; remote servers use `type: "http"` with `url` and optional `headers`. Per-server `timeout` values follow the documented minimum of 1000 milliseconds. The adapter does not edit user-managed state such as `~/.claude.json`, so MCP configuration is project-scoped only. Claude Code additionally requires interactive approval of project `.mcp.json` servers after installation.

## Planned support

- Runtime packages and plugin distribution. Neottia does not publish Claude Code plugins, and single-file extension requests cannot represent the multi-file plugin format. Package activation is unsupported today.
- User-scope MCP configuration. The installer currently avoids host-managed files. A future release may add reviewed operations for user scope.
- Other Copilot, Codex, and Kiro adapters. Research for issue [#119](https://github.com/dragoscirjan/neottia/issues/119) ranks GitHub Copilot CLI next; see [the adapter contract](/harnesses/adapters) for the shared rules every adapter follows.

## Installation

The compiler and installer apply the projected assets under your selected scope. After installation, restart Claude Code so commands, agents, and MCP configuration load together, then approve the project `.mcp.json` servers in the `/mcp` panel. The restart recommendation is Neottia adapter policy; Claude Code reloads some resources live but does not document one reload command for every asset type.

## Authentication and configuration

Claude Code manages its own sign-in, settings files, and OAuth for remote MCP servers. Neottia plans keep credential references such as `{env:ISSUES_TOKEN}` unresolved and never write authentication state. Configure the host authentication separately from Neottia installation.

The adapter does not list a tested Claude Code version because repository validation projects assets without executing the binary.
