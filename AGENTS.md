## Project

- Name is Neottia
- Goal is to provide a full SDLC understood by multiple AI harnesses
- Harnesses covered by Neottia (an `extensions/<harness>` module exists for them):
  - [x] OpenCode
  - [x] Pi
- Harnesses planned for future support (not urgent):
  - [ ] ClaudeCode
  - [ ] Codex
  - [ ] Copilot
  - [ ] Kiro

## Task Management

- GitHub is the default Git hosting for this project
- When asked to create an issue or read an issue, you will refer to the Issues section of the Repository and use `gh` or the GitHub MCP
- When asked to create a design document or read one, you will refer to the Wiki section of the Repository and use `gh` or GitHub MCP

## Toolchain

- pnpm is the only package manager -> never use npm, yarn, or bun
- mise is the only task interface -> prefer `mise run <task>` over raw pnpm commands; run `mise tasks` to list available tasks

## Versioning and Releases

- Module versions are managed only through Changesets (`mise run changeset`) -> never hand-edit `version` fields in `package.json`
- Global releases are prepared only via `mise run release:global -- <semver>`
- `packages/release/release-manifest.json` is generated -> never edit it manually

## Code

- Project is written using TypeScript (compile it only for generic modules or modules where harnesses do not understand TypeScript) - don't bother compiling modules unless necessary
- Follow Google coding standards for coding -> <https://google.github.io/styleguide/tsguide.html>
- Always comment your code -> if the comment tries to explain something too much, it could be that the specific code is too complex or wrong -> simplify it
- All node packages will have
  - `@neottia/` as organization / namespace
  - their own LICENSE -> if not mentioned otherwise you will use MIT (make sure you add the package to the main LICENSE file)
  - their own README documenting what the package does -> make sure you properly document the code

- Whenever asked to develop a new feature
  - Make sure you create a branch, commit everything and create a PR for it (NEVER merge PRs without prior consent)
  - The branch is reflected as a git worktree under `../neottia--workspaces/<branch-name>` (worktree name matches the branch name) to enable parallel work

## Code Inspection

- When coding or inspecting code, a code indexing tool MUST be used and evaluated for the task at hand
- The default code indexing tool is the `codeindex_cgc` MCP
  - Index the repository (or branch worktree) with `add_code_to_graph` before relying on it -> use `watch_directory` while actively developing
  - The indexer does NOT respect `.gitignore` -> run `mise run clean` before indexing so generated artifacts (`dist/`, `.jscpd/`, `docs/.vitepress/dist/`) do not pollute the graph
  - Always scope queries with `repo_path` -> unscoped queries mix all indexed repositories
- Code indexing MCPs are known to be weak with mono-repos -> if the available indexing tools are not useful for the task, do not hesitate to say so and suggest a better alternative (e.g. `codeindex_gitnexus` for commit-anchored impact analysis)

## Commits

- Follow Conventional Commits (e.g. `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)

## Testing

- Colocate test files with the source they test
- `.spec.ts` files are unit tests
- `.test.ts` files are integration tests
- Integration tests MUST use temporary folders ONLY -> the repository and workspace folders must remain immutable while testing
- Run `mise run validate` before pushing

## Documentation

- Project has a docs folder using VitePress
- Document the project every time you see fit
- DO NOT document how to develop the code; document ONLY how users should use the Project

## README.md

- Documentation must be summarised under README.md
- README.md can also contain a section on how to develop - I keep forgetting all the mise run commands for example and the project structure
