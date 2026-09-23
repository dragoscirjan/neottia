# Neottia

Neottia provides a shared SDLC that can be understood and used by multiple AI coding harnesses.

## Repository layout

```text
├── extensions/          # Independently versioned runtime and asset adapters
│   ├── pi-adapter/      # Declarative Pi asset projection
│   ├── opencode-adapter/# Declarative OpenCode asset projection
│   └── claude-code-adapter/ # Declarative Claude Code asset projection
├── packages/
│   ├── cli/             # Installable Neottia command-line application
│   ├── config/          # Shared layered configuration platform
│   ├── config-registry/ # Official strict host contribution registry
│   ├── core/            # Independently versioned core package
│   ├── distribution/    # Asset manifests, receipts, plans, and transactions
│   ├── design-docs/     # Canonical design documents and shared tools
│   ├── design-docs-mcp/ # Generic Design Docs MCP server
│   ├── memory-core/     # Canonical memory library and config schema
│   ├── memory-mcp/      # MCP memory server
│   ├── issues/          # Canonical issue domain and tool registry
│   ├── issues-design-docs/ # Cycle-free issue/design-document composition
│   ├── issues-mcp/      # Generic MCP issue server
│   ├── harness-adapter/ # Host-neutral adapter contract and registry
│   ├── repository-store/# Canonical repository persistence primitives
│   ├── searchable-core/ # Searchable runtime and shared tool registry
│   ├── searchable-mcp/  # Generic Searchable MCP server
│   ├── sdlc/            # Canonical lifecycle configuration and compiler
│   └── release/         # Global release bill of materials
├── docs/                # User documentation for VitePress
├── .changeset/          # Module release declarations
├── mise.toml            # Tool versions and developer tasks
└── pnpm-workspace.yaml  # pnpm module discovery
```

There is no root `src/` directory. Product code belongs to a module under `packages/` or `extensions/`.

## Development

Install [mise](https://mise.jdx.dev/getting-started.html), then run:

```bash
mise trust
mise run deps:sync
mise run validate
```

Common tasks:

```bash
mise run run             # Run @neottia/core
mise run build           # Build all modules
mise run test                     # Test all modules
mise run test:harness             # Run deterministic harness contracts
mise run test:harness:live        # Run optional live LLM acceptance
mise run test:memory:postgres     # Run the disposable PostgreSQL memory contract
mise run test:coverage            # Generate aggregate coverage
mise run format                   # Format the repository
mise run lint            # Lint and fix the repository
mise run docs            # Build user documentation
mise run docs:serve      # Serve user documentation locally
```

Use `mise tasks` for the complete task list. Mise remains the project task interface; its tasks delegate package operations to pnpm.

## Code review

Every non-draft pull request receives a model review from the [Code review](.github/workflows/code-review.yml) workflow. The [code-review action](https://github.com/dragoscirjan/code-review) runs the Pi backend in a hardened container, adds `cgc` code-index context for the reviewed base revision, and publishes a validated summary through the token's actor. It never executes pull request code.

The workflow needs two repository secrets. `GH_TOKEN` is a personal access token with pull request read and write access, because managed review comments must be actor-owned. `REVIEW_MODEL_CREDENTIALS` maps the configured credential reference to a provider token, for example `{"review-provider":{"type":"bearer","value":"<token>"}}`. The provider model is configured in the workflow file itself and holds no secrets.

## Releases

Modules are independently versioned with [Changesets](https://github.com/changesets/changesets). Describe every user-visible change as a changeset before merging:

```bash
mise run changeset
```

CI handles the rest. When changesets accumulate on `main`, a `CI » Release` job opens or refreshes one `chore: version packages` pull request. Merging that PR applies the version bumps and writes every package `CHANGELOG.md` with pull-request and commit links. After the version PR merges, a publish job runs `mise run validate`, then publishes every changed package to npm with `changeset publish` and creates the matching GitHub releases and tags. Publishing uses an `NPM_TOKEN` secret stored in the `npm` GitHub environment.

You can run the same steps locally:

```bash
mise run version:modules   # Apply pending changesets to module versions
mise run release:modules   # Build every module, then publish changed packages
```

A global Neottia release has its own version and exact module bill of materials. Prepare one after publishing its module versions:

```bash
mise run release:global -- 1.0.0
```

This updates `packages/release/package.json` and `packages/release/release-manifest.json`. The published `@neottia/release` package converts exact `workspace:` references into exact registry versions, making the global release reproducible.

## Configuration

`@neottia/config` composes domain-owned schemas into one immutable snapshot. It loads optional global and project YAML, applies profiles, environment bindings, and explicit overrides in a fixed order, tracks value-free leaf provenance, and redacts declared secrets. `@neottia/config-registry` supplies the strict official registry used by Neottia hosts, so all published module and SDLC capability shards can coexist in one root file. `@neottia/sdlc` validates compile-time provider selections and compiles the canonical lifecycle for Pi, OpenCode, or Claude Code. Use the [unified configuration guide](docs/configuration.md) for files, profiles, precedence, SDLC provider selection, secrets, diagnostics, embedding, and `skills.*` migration. The config package publishes the complete editor schema as `@neottia/config/config.schema.json`.

## Memory

Install `@neottia/memory-core` for the library, `@neottia/memory-mcp` for an MCP server, or the `@neottia/pi-memory` / `@neottia/opencode-memory` extensions for in-process harness tools. Configure the canonical `modules.memory` shard in `.neottia/config.yml` (`skills.memory` remains a deprecated compatibility alias); the user-facing setup and operations guide is [here](docs/memory/). Filesystem domains share the crash-recoverable primitives documented in the [repository-store guide](docs/repository-store.md). Track the canonical YAML files, but ignore `.neottia/memory/index.db` and its `-wal` and `-shm` cache sidecars.

## Issues

Enable `modules.issues` to manage Git-trackable YAML issues with exact revisions, durable recursive archive/restore, typed design-document links, and a disposable ranked FTS5 cache. `@neottia/issues` exports a shared configuration contribution while retaining `loadIssueConfig()` and the deprecated `skills.issues` alias for standalone compatibility. Use the package directly, `@neottia/issues-mcp` over stdio, or the in-process Pi/OpenCode extensions. See the [Issues guide](docs/issues/).

## Design Docs

Install `@neottia/design-docs` for strict repository-local Markdown/YAML design records, `@neottia/design-docs-mcp` for generic stdio MCP, or the Pi/OpenCode extensions for in-process tools. Enable `modules.design_docs` in `.neottia/config.yml`; enable `modules.issues` too for real stable-link validation through `@neottia/issues-design-docs`. Design Docs roots use safe project-relative paths and may contain Unicode directory names. The [Design Docs guide](docs/design-docs/) covers authoring, approval, immutable versioning, BM25 search, archive/restore, stable issue references, migration, and recovery.

## Searchable

Enable `modules.searchable` to search DuckDuckGo, Google, Bing, or Brave; extract bounded Markdown; stash canonical page records; search them with a disposable FTS5 cache; and ask a local Ollama model grounded questions. Use `@neottia/searchable-core` directly, `@neottia/searchable-mcp` over stdio, or the native Pi/OpenCode extensions. See the [Searchable guide](docs/searchable/).

## Delivery methods

Pi and OpenCode each have native Memory, Issues, Design Docs, and Searchable extensions. Other MCP-compatible clients can launch the four generic stdio servers. TypeScript applications can embed the domain libraries directly.

`@neottia/harness-adapter` defines a host-neutral, immutable asset projection contract. `@neottia/pi-adapter`, `@neottia/opencode-adapter`, and `@neottia/claude-code-adapter` return symbolic paths, package declarations, reviewable host-configuration operations, and reload notices without writing files or running host commands. Each adapter declares unsupported features instead of emulating them. See the [harness adapter guide](docs/harnesses/adapters.md).

## Canonical SDLC

`@neottia/sdlc` ships Plan, Build, Verify, Release, Continue, and Refresh as provider-neutral `.md.twig` files. It loads conventional `.neottia/templates/sdlc/<command>.md.twig` overrides, inserts checksummed provider and role fragments with Twing, records provenance, and returns adapter-projected asset manifests. Built-in compile-time bundles cover GitHub, GitLab, Gitea, Forgejo, Bitbucket, Jira, and Confluence with strict connection settings, tool prerequisites, and no cross-tool mutation retry. Per-harness role assignments preserve the same duties and bounded evidence contracts, with current-agent execution in Pi and supported native subagents in OpenCode and Claude Code. Runtime package IDs and exact versions remain explicit inputs. See the [SDLC compiler guide](docs/sdlc/), [provider instruction-pack guide](docs/sdlc/providers.md), and [portable role assignment guide](docs/sdlc/roles.md).

## Distribution

`@neottia/distribution` converts adapter output into checksummed manifests and reviewable plans. Receipts track file ownership and individual host-configuration entries. Apply uses exact checksum guards, before-image journals, rollback, and recovery. Static third-party skills are acquired through the bundled `skills` package in an isolated staging project before adapters select their final paths.

`@neottia/cli` publishes the `neottia` command. `neottia init` writes the minimal `.neottia/config.yml` for one or more harnesses. Planning and applying are separate commands, and conflicts require exact per-item approval. See the [distribution guide](docs/distribution/).

## Supporting packages

`@neottia/repository-store` provides Linux filesystem authority, exact revisions, durable batches, leases, recovery, and disposable SQLite adapters. `@neottia/core` remains a template-level greeting utility. `@neottia/release` publishes a versioned bill of materials, while private `@neottia/testkit` supplies temporary adapter conformance environments and other repository test helpers.

## Documentation

Start with the [delivery chooser](docs/get-started/) and [complete module catalog](docs/reference/modules.md). User documentation is under [`docs/`](docs/) and built with VitePress. `mise run docs:check` validates catalog coverage, routes, links, configuration examples, and documented tool registries.

## License

[MIT](LICENSE). Bootstrapped from [`templ-project/typescript`](https://github.com/templ-project/typescript).
