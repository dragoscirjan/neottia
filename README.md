# Neottia

Neottia provides a shared SDLC that can be understood and used by multiple AI coding harnesses.

## Repository layout

```text
├── extensions/          # Independently versioned harness extensions
├── packages/
│   ├── core/            # Independently versioned core package
│   ├── design-docs/     # Canonical design documents and shared tools
│   ├── design-docs-mcp/ # Generic Design Docs MCP server
│   ├── memory-core/     # Canonical memory library and config schema
│   ├── memory-mcp/      # MCP memory server
│   ├── issues/          # Canonical issue domain and tool registry
│   ├── issues-mcp/      # Generic MCP issue server
│   ├── repository-store/# Canonical repository persistence primitives
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
mise run test            # Test all modules
mise run test:coverage   # Generate aggregate coverage
mise run format          # Format the repository
mise run lint            # Lint and fix the repository
mise run docs            # Build user documentation
mise run docs:serve      # Serve user documentation locally
```

Use `mise tasks` for the complete task list. Mise remains the project task interface; its tasks delegate package operations to pnpm.

## Releases

Modules are independently versioned with [Changesets](https://github.com/changesets/changesets):

```bash
mise run changeset
mise run version:modules
mise run release:modules
```

A global Neottia release has its own version and exact module bill of materials. Prepare one after publishing its module versions:

```bash
mise run release:global -- 1.0.0
```

This updates `packages/release/package.json` and `packages/release/release-manifest.json`. The published `@neottia/release` package converts exact `workspace:` references into exact registry versions, making the global release reproducible.

## Memory

Install `@neottia/memory-core` for the library, `@neottia/memory-mcp` for an MCP server, or the `@neottia/pi-memory` / `@neottia/opencode-memory` extensions for in-process harness tools. Configure the `skills.memory` shard in `.neottia/config.yml`; the user-facing setup and operations guide is [here](docs/memory/). Filesystem domains share the crash-recoverable primitives documented in the [repository-store guide](docs/repository-store.md).

## Issues

Enable `skills.issues` to manage Git-trackable YAML issues with exact revisions, durable recursive archive/restore, typed design-document links, and a disposable ranked FTS5 cache. Use `@neottia/issues` directly, `@neottia/issues-mcp` over stdio, or the in-process Pi/OpenCode extensions. See the [Issues guide](docs/issues/).

## Design Docs

Install `@neottia/design-docs` for strict repository-local Markdown/YAML design records, `@neottia/design-docs-mcp` for generic stdio MCP, or the Pi/OpenCode extensions for in-process tools. Enable `skills.design_docs` in `.neottia/config.yml`. The [Design Docs guide](docs/design-docs/) covers authoring, approval, immutable versioning, BM25 search, archive/restore, stable issue references, migration, and recovery.

## Documentation

User documentation is under [`docs/`](docs/) and built with VitePress.

## License

[MIT](LICENSE). Bootstrapped from [`templ-project/typescript`](https://github.com/templ-project/typescript).
