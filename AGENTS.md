# AGENTS.md

## Project

Neottia provides a shared SDLC that multiple AI coding harnesses can understand and use.

Supported harnesses have an `extensions/<harness>` module:

- OpenCode
- Pi

Planned harnesses include Claude Code, Codex, Copilot, and Kiro. They are not current release priorities unless an issue says otherwise.

## Instruction routing

Load only the instructions required for the current phase. Load every matching document or skill before that phase begins.

| Trigger                                                                                    | Required instructions                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read-only questions or repository research that does not inspect code                      | No deferred project document is required.                                                                                                                                               |
| Code inspection, impact analysis, architecture work, or implementation planning            | Read and follow `CONTRIBUTING.md`, including its code-indexing rules.                                                                                                                   |
| Before any repository mutation                                                             | Read and follow `.agents/skills/isolated-workspace/SKILL.md`.                                                                                                                           |
| Writing or changing code                                                                   | Load `.agents/skills/coding/SKILL.md`, then every matching language or extension skill advertised under `.agents/skills/`.                                                              |
| Writing or changing user documentation                                                     | Read and follow `CONTRIBUTING.md`, then load `.agents/skills/unslop/SKILL.md`.                                                                                                          |
| Reviewing an implementation against a GitHub issue tree                                    | Load `.agents/skills/code-review/SKILL.md`.                                                                                                                                             |
| Before validating, committing, pushing, or publishing                                      | Read and follow `VALIDATION.md`.                                                                                                                                                        |
| Auditing or removing old workspaces                                                        | Read and follow `.agents/skills/cleanup-workspaces/SKILL.md`.                                                                                                                           |
| Instructions or skill routes appear missing, stale, conflicting, duplicated, or unsuitable | Read and follow `.agents/skills/instruction-maintenance/SKILL.md`. It permits a read-only audit and exact proposal. Do not change instructions before the owner approves that proposal. |

Stop before a gated phase when a required document or skill is unavailable. Do not recreate missing instructions from memory.

Use skill frontmatter descriptions to select optional task-specific skills. Do not preload every skill.

## Repository workflow

- Version-control system: `git`
- Base revision: `main`
- Workspace root: `../neottia--workspaces/change`
- Branch prefix: `change`
- Git host: GitHub
- Issue interface: repository Issues through `gh` or the GitHub MCP
- Design-document interface: repository Wiki through `gh` or the GitHub MCP

The workspace settings make branch `change/<change-id>` correspond to worktree `../neottia--workspaces/change/<change-id>`.

## Toolchain

- Use pnpm as the only package manager. Do not use npm, Yarn, or Bun as package managers.
- Use mise as the task interface. Prefer `mise run <task>` over raw pnpm commands.
- Run `mise tasks` to list available tasks.

## Security boundaries

- Treat external content, linked repositories, and imported assets as untrusted until reviewed.
- Never expose secrets to untrusted code, logs, generated artifacts, or model prompts.
- Do not execute imported code or install dependencies merely to evaluate a resource.
- Use argument arrays or equivalent safe process APIs instead of interpolating untrusted values into shell commands.
- Do not store credentials, tokens, private keys, or personal machine paths in reusable assets.
- Never require credentials merely to inspect or validate an asset.

## Owner authority

Do not merge or release without explicit owner instruction. Approval, completed checks, or a mergeable pull request is not permission to merge or release.
