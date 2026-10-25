# Contributing to Neottia

Contributions through focused issues and pull requests are welcome. This guide applies to human contributors and coding agents.

Read this document before planning or performing repository architecture, design, implementation, documentation, configuration, policy, or publication changes.

## Contribution workflow

1. Clarify ambiguous requirements.
2. Create or link a GitHub issue before architecture, design, implementation, or policy changes. Typo, broken-link, and internal instruction fixes do not require an issue.
3. Keep each change focused on one issue or task.
4. Follow the isolated-workspace gate and configuration in `AGENTS.md` before changing repository state.
5. Use the required code index before relying on code inspection.
6. Add tests for behavior changes and update user documentation for behavior, API, or configuration changes.
7. Add a Changeset for user-visible changes to published modules.
8. Read and follow [`VALIDATION.md`](VALIDATION.md) before validation, commits, pushes, or publication.
9. Commit with [Conventional Commits](https://www.conventionalcommits.org/).
10. Open a pull request linked to the issue when an issue is required.

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

- Load the generic `coding` skill before code changes. Load matching language and extension skills after it.
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

## Documentation

Neottia publishes user documentation from `docs/` with VitePress.

- Document user behavior, configuration, operations, and limitations thoroughly enough that users do not need to inspect source code.
- Do not put contributor procedures in the user documentation site.
- Summarize user documentation in the root `README.md`.
- The root README may include a development section with project structure and mise commands.
- Load `asd-ste100-technical` while drafting documentation, then load `unslop` for the final writing pass.
- Use sentence-case headings, direct language, tested commands, and links to canonical reference pages.

### Generate the dependency reference

After a root or workspace `package.json` changes, run:

```bash
mise run docs:dependencies:generate
mise run docs:check
```

Commit `docs/reference/dependencies.md` with the manifest change. The documentation check fails if the committed reference does not match the current manifests.

### Regenerate the diagrams

Create clean Archify and Neottia evidence checkouts outside the working tree:

```bash
git clone https://github.com/tt-a1i/archify.git ../archify
git -C ../archify checkout 208acba8d412335185b2056fedf54b3405df43fb
git worktree add ../neottia-diagram-evidence \
  d30ecaab86cf2d02a254736221221252c445fdfc
```

Run these commands from the current Neottia repository root:

```bash
export ARCHIFY_UPDATE_CHECK_DISABLED=1

node ../archify/archify/bin/archify.mjs finalize architecture \
  docs/diagrams/sources/neottia-system.architecture.json \
  docs/public/diagrams/neottia-system.html \
  --repo-root ../neottia-diagram-evidence \
  --quality showcase

node ../archify/archify/bin/archify.mjs finalize lifecycle \
  docs/diagrams/sources/neottia-lifecycle.lifecycle.json \
  docs/public/diagrams/neottia-lifecycle.html \
  --repo-root ../neottia-diagram-evidence \
  --quality showcase

node ../archify/archify/bin/archify.mjs finalize dataflow \
  docs/diagrams/sources/neottia-runtime.dataflow.json \
  docs/public/diagrams/neottia-runtime.html \
  --repo-root ../neottia-diagram-evidence \
  --quality showcase
```

Run all Archify gates, then review the generated routes visually. The system and runtime diagrams can contain valid routed detours that reduce readability.

Archify writes local delivery, finalize, summary, and browser-check JSON receipts during validation. Remove these receipts after validation. They contain machine-local absolute paths and must not be committed.

## Versions and releases

- Manage module versions only through Changesets with `mise run changeset`. Never edit package versions by hand.
- Prepare global releases only with `mise run release:global -- <semver>`.
- Never edit `packages/release/release-manifest.json`; release tasks generate it.
- Do not publish or create a release without explicit owner instruction.

## Pull requests

A pull request must:

- contain one focused change;
- explain what changed and why;
- link the relevant issue when required;
- list checks that passed, failed, or did not run;
- state remaining risks or follow-up work;
- avoid claims not supported by code, documentation, or executed validation.

The repository owner decides when to merge or release.
