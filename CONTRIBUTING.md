# Contributing to Neottia

Contributions through focused issues and pull requests are welcome. This guide applies to human contributors and coding agents.

Read before planning or changing the repository. Follow `AGENTS.md` for phase prerequisites, workspaces, safety, and owner authority.

This includes architecture, design, implementation, documentation, configuration, policy, and publication work.

## Task records and scope

Clarify ambiguous requirements. Create or link a GitHub issue before architecture, design, implementation, or policy changes. Typo, broken-link, and internal instruction fixes do not require an issue. Keep each change focused on one issue or task.

## Workflow

1. Confirm the outcome, scope, and required task record.
2. Satisfy the mutation and workspace rules in `AGENTS.md`.
3. Implement a focused change using the rules below.
4. Follow `DOCUMENTATION.md` while implementing. Explain any no-change documentation assessment.
5. Run applicable checks from `VALIDATION.md`. Report missing checks.
6. Follow the commit, PR, versioning, and publication rules. One phase does not authorize the next.

Use the required code index before relying on code inspection. Add tests for behavior changes and update user documentation for behavior, API, or configuration changes. Add a Changeset for user-visible changes to published modules.

Do not merge or release without explicit owner instruction.

## Development setup

```bash
git clone https://github.com/dragoscirjan/neottia.git
cd neottia
mise trust
mise run deps:sync
mise run validate
```

Use `mise tasks` for the complete task list. Mise is the task interface, and its tasks delegate package operations to pnpm.

## Code inspection

Use a code indexing tool when inspecting or changing code.

The default indexer is the `codeindex_cgc` MCP:

1. Run `mise run clean` before indexing. The indexer does not honor `.gitignore`, so generated `dist/`, `.jscpd/`, and `docs/.vitepress/dist/` output must not enter the graph.
2. Index the repository or active worktree with `add_code_to_graph`.
3. Use `watch_directory` while developing.
4. Scope every query with the active `repo_path`.
5. Evaluate whether the index answers the task reliably. Its monorepo support can be weak.

If `codeindex_cgc` is unavailable or unsuitable, record that limitation and use a better indexer when available. `codeindex_gitnexus` is preferred for commit-anchored impact analysis. Text search can supplement an index but does not satisfy a mandatory indexing step by itself.

## Human-approved instruction adaptation

When repository instructions no longer fit an observed workflow, follow the `instruction-maintenance` skill. An agent may inspect the instruction graph and present an exact proposal without prior approval. It must not change instructions until a human explicitly approves that proposal.

Approval is limited to the stated files and rule changes. Changed evidence, scope, dependencies, handoffs, or protected rules require a revised proposal and new approval. After approval, follow the normal issue, isolated-workspace, validation, commit, and pull-request gates.

This adaptation workflow covers instruction routes, deferred policy documents, dependency or handoff statements, and skill routing metadata. It does not authorize changes to detailed skill behavior.

## Code and package rules

- Load the generic `coding` skill, then `coding-with-rules`, before code design, edits, tests, or review. Read the wrapper's matching language and extension references in their declared order. Project configuration and the rules below take precedence.
- Neottia uses TypeScript for project code. Compile only generic modules or modules whose target harness cannot consume TypeScript directly.
- Follow the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) unless repository configuration or established safe conventions are stricter.
- Comment public contracts, invariants, security boundaries, and non-obvious decisions. Simplify code that needs commentary only because it is unnecessarily complex.
- Use kebab-case file names, camelCase functions and variables, and PascalCase classes.
- Use TSDoc for public TypeScript APIs.
- Follow the existing ESLint, Prettier, TypeScript, and test configuration.

#### Repository Store native backends

Repository Store native platform backends must use C++17 and the stable C Node-API (`node_api.h`) for both Node.js and Bun. Keep operating-system code behind internal capability interfaces. Do not introduce Rust, V8, libuv, Node.js C++ APIs, or separate runtime-specific native implementations without a separately approved architecture issue. Require benchmark evidence for performance claims; filesystem semantics and safety invariants take priority over language-level micro-optimizations.

Every Node package must:

- use the `@neottia/` namespace;
- include its own MIT `LICENSE` unless an approved design requires another license;
- be listed by the root license when required;
- include a README that explains user-facing purpose, installation, configuration, and usage.

## Tests

- Colocate tests with the source they test.
- Use `.spec.ts` for unit tests.
- Use `.test.ts` for integration tests.
- Integration tests must use temporary directories. They must not mutate the repository checkout or active worktree.
- Test observable behavior, failure paths, and relevant compatibility boundaries. A successful compile is not behavior evidence.

## Configuration

Use `docs/configuration.md` as the canonical reference for supported configuration sources, keys, defaults, required groups, and precedence. Use `packages/config/config.schema.json` for the complete public schema. Preserve the global/project resolver contract and module boundaries; do not infer configuration from unrelated installed packages. Keep credentials out of reusable examples, logs, artifacts, and model context.

## Documentation

Read and follow `DOCUMENTATION.md` for audience, engine, ownership, commands, and maintenance rules. Follow it while implementing. Explain any no-change documentation assessment.

## Versions and releases

- Manage module versions only through Changesets with `mise run changeset`. Never edit package versions by hand.
- Prepare global releases only with `mise run release:global -- <semver>`.
- Never edit `packages/release/release-manifest.json`; release tasks generate it.
- Do not publish or create a release without explicit owner instruction.

Release procedures do not grant publication authority. Follow `AGENTS.md`.

## Commits and pull requests

Commit with [Conventional Commits](https://www.conventionalcommits.org/). Open a pull request linked to the issue when an issue is required.

A pull request must:

- contain one focused change;
- explain what changed and why;
- link the relevant issue when required;
- list checks that passed, failed, or did not run;
- state remaining risks or follow-up work;
- avoid claims not supported by code, documentation, or executed validation.

The repository owner decides when to merge or release.
