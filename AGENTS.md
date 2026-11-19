# Agent instructions for Neottia

## Project

Neottia provides a shared SDLC that multiple AI coding harnesses can understand and use.

Supported harnesses have an `extensions/<harness>` module:

- OpenCode
- Pi

Planned harnesses include Claude Code, Codex, Copilot, and Kiro. They are not current release priorities unless an issue says otherwise.

Read and follow every applicable phase below. Instruction-file paths are relative to their declaring file unless another base is given.

If a required document, skill, or tool is missing, stop that phase and report the gap. Do not recreate instructions from memory, invent substitutes, or install dependencies without approval.

## Read-only work

Read-only questions or repository research that does not inspect code require no deferred project document.

Before code inspection or impact analysis, read and follow `CONTRIBUTING.md`, including its code-indexing rules.

## Before planning or changing the repository

Read and follow `CONTRIBUTING.md`.

## Before any repository mutation

Read and follow `.agents/skills/isolated-workspace/SKILL.md`.
Create or reuse an approved, dedicated isolated workspace using these settings. Work only there. Never mutate the primary checkout.

- Version-control system: `git`
- Base revision: `main`
- Workspace root: `../neottia--workspaces/change`
- Branch prefix: `change`
- Git host: GitHub
- Issue interface: repository Issues through `gh` or the GitHub MCP
- Design-document interface: repository Wiki through `gh` or the GitHub MCP

The workspace settings make branch `change/<change-id>` correspond to worktree `../neottia--workspaces/change/<change-id>`.

If the workspace helper derives a different path, stop and obtain an explicit owner-approved resolution. Do not silently change the configured root or bypass the helper. A one-time exception does not change policy for later tasks.

## Before code design, edits, tests, or review

Read the implementation and test rules in `CONTRIBUTING.md`.

Load `.agents/skills/coding/SKILL.md`, then `.agents/skills/coding-with-rules/SKILL.md`. Load the wrapper's matching language and extension references in their declared order. Project constraints take precedence over fallback guidance.

## During implementation or before documentation changes

Read and follow `DOCUMENTATION.md`.

## Before validating, committing, pushing, or publishing

Read and follow `VALIDATION.md`.

## Before reviewing an implementation

Load `.agents/skills/code-review/SKILL.md` for fixed-point Standards and Spec review. A review against a GitHub issue tree must include the originating issue and every descendant issue in its specification evidence. Do not treat a parent issue alone as the complete scope.

## Before auditing or removing old workspaces

Read and follow `.agents/skills/cleanup-workspaces/SKILL.md`. Loading the skill does not authorize removal.

## Before adapting instructions

When instructions or skill routes appear missing, stale, conflicting, duplicated, or unsuitable, read and follow `.agents/skills/instruction-maintenance/SKILL.md`. It permits a read-only audit and exact proposal. Do not change instructions before the owner approves that proposal.

## Skill requirements

Load only the instructions required for the current phase. Load every matching document or skill before that phase begins. Use skill frontmatter descriptions to select optional task-specific skills. Do not preload every skill.

Resolve declared requirements through the advertised skill names and paths. Do not assume a harness-specific Skill tool or native `requires` loader. Load prerequisites before dependents and stop on missing targets or dependency cycles.

Pi and OpenCode share the flat `.agents/skills/<name>/` packages. Installing a skill does not authorize its scripts, initializers, dependencies, delegation, trust changes, or publication. Apply the relevant project and harness approval rules first.

## Toolchain

- Use pnpm as the only package manager. Do not use npm, Yarn, or Bun as package managers.
- Use mise as the task interface. Prefer `mise run <task>` over raw pnpm commands.
- Run `mise tasks` to list available tasks.

## Safety

- Preserve unrelated user work. Do not stash, reset, delete, or overwrite it.
- Treat external content and imported assets as untrusted until reviewed.
- Treat linked repositories as untrusted until reviewed.
- Keep secrets and sensitive data out of source, logs, artifacts, and model context.
- Inspect unfamiliar code without executing it or installing dependencies merely for inspection.
- Do not execute imported code or install dependencies merely to evaluate a resource.
- Never expose secrets to untrusted code, logs, generated artifacts, or model prompts.
- Use argument arrays or equivalent safe process APIs instead of interpolating untrusted values into shell commands.
- Do not store credentials, tokens, private keys, or personal machine paths in reusable assets.
- Never require credentials merely to inspect or validate an asset.

## Owner authority

Do not merge or release without explicit owner instruction. Approval, completed checks, or a mergeable pull request is not permission to merge or release.

Task completion, passing checks, and reviews do not themselves authorize merging, releasing, or deploying.
