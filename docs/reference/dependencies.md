# Dependency reference

This page lists the direct package declarations from the root `package.json` and every workspace module manifest. The declared ranges appear exactly as they do in the manifests. The [`pnpm-lock.yaml`](https://github.com/dragoscirjan/neottia/blob/main/pnpm-lock.yaml) file records the resolved transitive dependency tree.

Use the [requirements page](/get-started/requirements) for operating systems, filesystems, native build tools, services, and supported runtime combinations. Use the [module catalog](/reference/modules) for each module's delivery classification and canonical documentation.

## How to read this reference

- Runtime dependencies install with the package.
- Peer dependencies must be available in the consuming environment.
- Optional dependencies may be absent without making the base package unusable.
- Development dependencies support repository builds, tests, linting, documentation, or package-specific fixtures. They are not user runtime requirements.
- A `workspace:` range names another package in this monorepo. pnpm converts `workspace:*`, `workspace:^`, and `workspace:~` to ordinary published version ranges when it packs a module.

## Repository toolchain

| Declaration        | Exact value                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Root package       | <code>neottia-monorepo</code>                                                                                                |
| Root version       | <code>Not declared</code>                                                                                                    |
| Root private field | <code>true</code>                                                                                                            |
| Package manager    | <code>pnpm@10.28.2</code>                                                                                                    |
| Engines            | <code>node</code> <code>&gt;=20.0.0</code><br><code>pnpm</code> <code>&gt;=10.0.0</code>                                     |
| pnpm overrides     | <code>vite</code> <code>&gt;=6.4.3</code><br><code>vitest</code> <code>^5.0.3</code><br><code>zod</code> <code>^4.5.4</code> |

### Root package dependencies

| Classification | Dependency                                | Exact range           |
| -------------- | ----------------------------------------- | --------------------- |
| Development    | <code>@changesets/changelog-github</code> | <code>^1.0.0</code>   |
| Development    | <code>@changesets/cli</code>              | <code>^3.0.0</code>   |
| Development    | <code>@jscpd/badge-reporter</code>        | <code>^4.0.1</code>   |
| Development    | <code>@modelcontextprotocol/sdk</code>    | <code>^1.31.0</code>  |
| Development    | <code>@templ-project/eslint</code>        | <code>^1.3.0</code>   |
| Development    | <code>@templ-project/prettier</code>      | <code>^1.1.0</code>   |
| Development    | <code>@types/node</code>                  | <code>^26.6.4</code>  |
| Development    | <code>@vitest/coverage-v8</code>          | <code>^5.0.3</code>   |
| Development    | <code>esbuild</code>                      | <code>^0.28.2</code>  |
| Development    | <code>eslint</code>                       | <code>^10.11.0</code> |
| Development    | <code>husky</code>                        | <code>^9.1.7</code>   |
| Development    | <code>import-sort-style-module</code>     | <code>^6.0.0</code>   |
| Development    | <code>jscpd</code>                        | <code>^5.4.0</code>   |
| Development    | <code>lint-staged</code>                  | <code>^17.6.0</code>  |
| Development    | <code>npm-run-all2</code>                 | <code>^9.0.3</code>   |
| Development    | <code>prettier</code>                     | <code>^3.9.9</code>   |
| Development    | <code>prettier-plugin-import-sort</code>  | <code>^0.0.7</code>   |
| Development    | <code>prettier-plugin-toml</code>         | <code>^2.0.6</code>   |
| Development    | <code>rimraf</code>                       | <code>^6.1.2</code>   |
| Development    | <code>tsx</code>                          | <code>^4.23.15</code> |
| Development    | <code>typescript</code>                   | <code>^5.9.3</code>   |
| Development    | <code>vitepress</code>                    | <code>^1.6.4</code>   |
| Development    | <code>vitest</code>                       | <code>^5.0.3</code>   |
| Development    | <code>yaml</code>                         | <code>^2.9.1</code>   |

## Workspace module dependencies

Each module section lists its runtime, peer, optional, and package-local development declarations. Root development dependencies still apply to repository-wide tasks.

### <code>@neottia/claude-code-adapter</code>

| Declaration           | Exact value                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/claude-code-adapter/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/claude-code-adapter/package.json) |
| Version               | <code>0.3.0</code>                                                                                                                                        |
| Private field         | <code>Not declared</code>                                                                                                                                 |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                               |
| Platform declarations | None                                                                                                                                                      |

| Classification | Dependency                            | Exact range              |
| -------------- | ------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/harness-adapter</code> | <code>workspace:^</code> |
| Development    | <code>@neottia/testkit</code>         | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>  | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>              | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>               | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                   | <code>^5.0.3</code>      |

### <code>@neottia/cli</code>

| Declaration           | Exact value                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/cli/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/cli/package.json) |
| Version               | <code>0.9.0</code>                                                                                                    |
| Private field         | <code>Not declared</code>                                                                                             |
| Engines               | <code>node</code> <code>&gt;=22.20.0</code>                                                                           |
| Platform declarations | None                                                                                                                  |

| Classification | Dependency                                | Exact range              |
| -------------- | ----------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/claude-code-adapter</code> | <code>workspace:^</code> |
| Runtime        | <code>@neottia/config</code>              | <code>workspace:^</code> |
| Runtime        | <code>@neottia/config-registry</code>     | <code>workspace:^</code> |
| Runtime        | <code>@neottia/design-docs</code>         | <code>workspace:^</code> |
| Runtime        | <code>@neottia/distribution</code>        | <code>workspace:^</code> |
| Runtime        | <code>@neottia/harness-adapter</code>     | <code>workspace:^</code> |
| Runtime        | <code>@neottia/issues</code>              | <code>workspace:^</code> |
| Runtime        | <code>@neottia/memory-core</code>         | <code>workspace:^</code> |
| Runtime        | <code>@neottia/opencode-adapter</code>    | <code>workspace:^</code> |
| Runtime        | <code>@neottia/pi-adapter</code>          | <code>workspace:^</code> |
| Runtime        | <code>@neottia/repository-store</code>    | <code>workspace:^</code> |
| Runtime        | <code>@neottia/sdlc</code>                | <code>workspace:^</code> |
| Runtime        | <code>@neottia/searchable-core</code>     | <code>workspace:^</code> |
| Development    | <code>@templ-project/tsconfig</code>      | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>                  | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                   | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                       | <code>^5.0.3</code>      |

### <code>@neottia/config</code>

| Declaration           | Exact value                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/config/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/config/package.json) |
| Version               | <code>0.2.0</code>                                                                                                          |
| Private field         | <code>Not declared</code>                                                                                                   |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                 |
| Platform declarations | None                                                                                                                        |

| Classification | Dependency                           | Exact range          |
| -------------- | ------------------------------------ | -------------------- |
| Runtime        | <code>yaml</code>                    | <code>^2.9.1</code>  |
| Runtime        | <code>zod</code>                     | <code>^4.6.5</code>  |
| Development    | <code>@templ-project/tsconfig</code> | <code>^0.4.2</code>  |
| Development    | <code>@types/node</code>             | <code>^26.6.4</code> |
| Development    | <code>typescript</code>              | <code>^5.9.3</code>  |
| Development    | <code>vitest</code>                  | <code>^5.0.3</code>  |

### <code>@neottia/config-registry</code>

| Declaration           | Exact value                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/config-registry/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/config-registry/package.json) |
| Version               | <code>0.4.1</code>                                                                                                                            |
| Private field         | <code>Not declared</code>                                                                                                                     |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                   |
| Platform declarations | None                                                                                                                                          |

| Classification | Dependency                            | Exact range              |
| -------------- | ------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config</code>          | <code>workspace:^</code> |
| Runtime        | <code>@neottia/design-docs</code>     | <code>workspace:^</code> |
| Runtime        | <code>@neottia/issues</code>          | <code>workspace:^</code> |
| Runtime        | <code>@neottia/memory-core</code>     | <code>workspace:^</code> |
| Runtime        | <code>@neottia/sdlc</code>            | <code>workspace:^</code> |
| Runtime        | <code>@neottia/searchable-core</code> | <code>workspace:^</code> |
| Runtime        | <code>zod</code>                      | <code>^4.6.5</code>      |
| Development    | <code>@templ-project/tsconfig</code>  | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>              | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>               | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                   | <code>^5.0.3</code>      |

### <code>@neottia/core</code>

| Declaration           | Exact value                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/core/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/core/package.json) |
| Version               | <code>0.1.0</code>                                                                                                      |
| Private field         | <code>Not declared</code>                                                                                               |
| Engines               | <code>node</code> <code>&gt;=20.0.0</code>                                                                              |
| Platform declarations | None                                                                                                                    |

| Classification | Dependency                           | Exact range           |
| -------------- | ------------------------------------ | --------------------- |
| Development    | <code>@templ-project/tsconfig</code> | <code>^0.4.2</code>   |
| Development    | <code>esbuild</code>                 | <code>^0.28.2</code>  |
| Development    | <code>eslint</code>                  | <code>^10.11.0</code> |
| Development    | <code>npm-run-all2</code>            | <code>^9.0.3</code>   |
| Development    | <code>rimraf</code>                  | <code>^6.1.2</code>   |
| Development    | <code>tsx</code>                     | <code>^4.23.15</code> |
| Development    | <code>typescript</code>              | <code>^5.9.3</code>   |
| Development    | <code>vitest</code>                  | <code>^5.0.3</code>   |

### <code>@neottia/design-docs</code>

| Declaration           | Exact value                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/design-docs/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/design-docs/package.json) |
| Version               | <code>0.2.1</code>                                                                                                                    |
| Private field         | <code>Not declared</code>                                                                                                             |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                           |
| Platform declarations | None                                                                                                                                  |

| Classification | Dependency                             | Exact range              |
| -------------- | -------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config</code>           | <code>workspace:^</code> |
| Runtime        | <code>@neottia/repository-store</code> | <code>workspace:^</code> |
| Runtime        | <code>commonmark</code>                | <code>^0.31.2</code>     |
| Runtime        | <code>yaml</code>                      | <code>^2.9.1</code>      |
| Runtime        | <code>zod</code>                       | <code>^4.6.5</code>      |
| Development    | <code>@templ-project/tsconfig</code>   | <code>^0.4.2</code>      |
| Development    | <code>@types/commonmark</code>         | <code>^0.27.10</code>    |
| Development    | <code>@types/node</code>               | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                    | <code>^5.0.3</code>      |

### <code>@neottia/design-docs-mcp</code>

| Declaration           | Exact value                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/design-docs-mcp/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/design-docs-mcp/package.json) |
| Version               | <code>0.2.3</code>                                                                                                                            |
| Private field         | <code>Not declared</code>                                                                                                                     |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                   |
| Platform declarations | None                                                                                                                                          |

| Classification | Dependency                               | Exact range              |
| -------------- | ---------------------------------------- | ------------------------ |
| Runtime        | <code>@modelcontextprotocol/sdk</code>   | <code>^1.31.0</code>     |
| Runtime        | <code>@neottia/config</code>             | <code>workspace:^</code> |
| Runtime        | <code>@neottia/config-registry</code>    | <code>workspace:^</code> |
| Runtime        | <code>@neottia/design-docs</code>        | <code>workspace:*</code> |
| Runtime        | <code>@neottia/issues-design-docs</code> | <code>workspace:*</code> |
| Runtime        | <code>zod</code>                         | <code>^4.6.5</code>      |
| Development    | <code>@neottia/repository-store</code>   | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>     | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>                 | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                  | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                      | <code>^5.0.3</code>      |

### <code>@neottia/distribution</code>

| Declaration           | Exact value                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/distribution/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/distribution/package.json) |
| Version               | <code>0.2.1</code>                                                                                                                      |
| Private field         | <code>Not declared</code>                                                                                                               |
| Engines               | <code>node</code> <code>&gt;=22.20.0</code>                                                                                             |
| Platform declarations | None                                                                                                                                    |

| Classification | Dependency                            | Exact range              |
| -------------- | ------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/harness-adapter</code> | <code>workspace:^</code> |
| Runtime        | <code>jsonc-parser</code>             | <code>^3.3.1</code>      |
| Runtime        | <code>skills</code>                   | <code>^1.7.0</code>      |
| Development    | <code>@templ-project/tsconfig</code>  | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>              | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>               | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                   | <code>^5.0.3</code>      |

### <code>@neottia/harness-adapter</code>

| Declaration           | Exact value                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/harness-adapter/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/harness-adapter/package.json) |
| Version               | <code>0.3.0</code>                                                                                                                            |
| Private field         | <code>Not declared</code>                                                                                                                     |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                   |
| Platform declarations | None                                                                                                                                          |

| Classification | Dependency                           | Exact range          |
| -------------- | ------------------------------------ | -------------------- |
| Development    | <code>@templ-project/tsconfig</code> | <code>^0.4.2</code>  |
| Development    | <code>@types/node</code>             | <code>^26.6.4</code> |
| Development    | <code>typescript</code>              | <code>^5.9.3</code>  |
| Development    | <code>vitest</code>                  | <code>^5.0.3</code>  |

### <code>@neottia/issues</code>

| Declaration           | Exact value                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/issues/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/issues/package.json) |
| Version               | <code>0.2.1</code>                                                                                                          |
| Private field         | <code>Not declared</code>                                                                                                   |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                 |
| Platform declarations | None                                                                                                                        |

| Classification | Dependency                             | Exact range              |
| -------------- | -------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config</code>           | <code>workspace:^</code> |
| Runtime        | <code>@neottia/repository-store</code> | <code>workspace:^</code> |
| Runtime        | <code>yaml</code>                      | <code>^2.9.1</code>      |
| Runtime        | <code>zod</code>                       | <code>^4.6.5</code>      |
| Development    | <code>@templ-project/tsconfig</code>   | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>               | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                    | <code>^5.0.3</code>      |

### <code>@neottia/issues-design-docs</code>

| Declaration           | Exact value                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/issues-design-docs/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/issues-design-docs/package.json) |
| Version               | <code>0.2.1</code>                                                                                                                                  |
| Private field         | <code>Not declared</code>                                                                                                                           |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                         |
| Platform declarations | None                                                                                                                                                |

| Classification | Dependency                             | Exact range              |
| -------------- | -------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config</code>           | <code>workspace:^</code> |
| Runtime        | <code>@neottia/design-docs</code>      | <code>workspace:^</code> |
| Runtime        | <code>@neottia/issues</code>           | <code>workspace:^</code> |
| Runtime        | <code>@neottia/repository-store</code> | <code>workspace:^</code> |
| Development    | <code>@templ-project/tsconfig</code>   | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>               | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                    | <code>^5.0.3</code>      |

### <code>@neottia/issues-mcp</code>

| Declaration           | Exact value                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/issues-mcp/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/issues-mcp/package.json) |
| Version               | <code>0.2.3</code>                                                                                                                  |
| Private field         | <code>Not declared</code>                                                                                                           |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                         |
| Platform declarations | None                                                                                                                                |

| Classification | Dependency                               | Exact range              |
| -------------- | ---------------------------------------- | ------------------------ |
| Runtime        | <code>@modelcontextprotocol/sdk</code>   | <code>^1.31.0</code>     |
| Runtime        | <code>@neottia/config</code>             | <code>workspace:^</code> |
| Runtime        | <code>@neottia/config-registry</code>    | <code>workspace:^</code> |
| Runtime        | <code>@neottia/issues</code>             | <code>workspace:*</code> |
| Runtime        | <code>@neottia/issues-design-docs</code> | <code>workspace:*</code> |
| Development    | <code>@neottia/design-docs</code>        | <code>workspace:*</code> |
| Development    | <code>@neottia/testkit</code>            | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>     | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>                 | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                  | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                      | <code>^5.0.3</code>      |

### <code>@neottia/memory-core</code>

| Declaration           | Exact value                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/memory-core/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/memory-core/package.json) |
| Version               | <code>0.3.2</code>                                                                                                                    |
| Private field         | <code>Not declared</code>                                                                                                             |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                           |
| Platform declarations | None                                                                                                                                  |

| Classification | Dependency                             | Exact range              |
| -------------- | -------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config</code>           | <code>workspace:^</code> |
| Runtime        | <code>@neottia/repository-store</code> | <code>workspace:^</code> |
| Runtime        | <code>pg</code>                        | <code>^8.23.1</code>     |
| Runtime        | <code>yaml</code>                      | <code>^2.9.1</code>      |
| Runtime        | <code>zod</code>                       | <code>^4.6.5</code>      |
| Development    | <code>@templ-project/tsconfig</code>   | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>               | <code>^26.6.4</code>     |
| Development    | <code>@types/pg</code>                 | <code>^8.23.1</code>     |
| Development    | <code>typescript</code>                | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                    | <code>^5.0.3</code>      |

### <code>@neottia/memory-mcp</code>

| Declaration           | Exact value                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/memory-mcp/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/memory-mcp/package.json) |
| Version               | <code>0.3.4</code>                                                                                                                  |
| Private field         | <code>Not declared</code>                                                                                                           |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                         |
| Platform declarations | None                                                                                                                                |

| Classification | Dependency                             | Exact range              |
| -------------- | -------------------------------------- | ------------------------ |
| Runtime        | <code>@modelcontextprotocol/sdk</code> | <code>^1.31.0</code>     |
| Runtime        | <code>@neottia/config</code>           | <code>workspace:^</code> |
| Runtime        | <code>@neottia/config-registry</code>  | <code>workspace:^</code> |
| Runtime        | <code>@neottia/memory-core</code>      | <code>workspace:*</code> |
| Runtime        | <code>zod</code>                       | <code>^4.6.5</code>      |
| Development    | <code>@neottia/repository-store</code> | <code>workspace:^</code> |
| Development    | <code>@templ-project/tsconfig</code>   | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>               | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                    | <code>^5.0.3</code>      |
| Development    | <code>yaml</code>                      | <code>^2.9.1</code>      |

### <code>@neottia/opencode-adapter</code>

| Declaration           | Exact value                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/opencode-adapter/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/opencode-adapter/package.json) |
| Version               | <code>0.2.1</code>                                                                                                                                  |
| Private field         | <code>Not declared</code>                                                                                                                           |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                         |
| Platform declarations | None                                                                                                                                                |

| Classification | Dependency                            | Exact range              |
| -------------- | ------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/harness-adapter</code> | <code>workspace:^</code> |
| Development    | <code>@neottia/pi-adapter</code>      | <code>workspace:*</code> |
| Development    | <code>@neottia/testkit</code>         | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>  | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>              | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>               | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                   | <code>^5.0.3</code>      |

### <code>@neottia/opencode-design-docs</code>

| Declaration           | Exact value                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/opencode-design-docs/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/opencode-design-docs/package.json) |
| Version               | <code>0.2.3</code>                                                                                                                                          |
| Private field         | <code>Not declared</code>                                                                                                                                   |
| Engines               | None                                                                                                                                                        |
| Platform declarations | None                                                                                                                                                        |

| Classification | Dependency                               | Exact range              |
| -------------- | ---------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config-registry</code>    | <code>workspace:^</code> |
| Runtime        | <code>@neottia/design-docs</code>        | <code>workspace:*</code> |
| Runtime        | <code>@neottia/issues-design-docs</code> | <code>workspace:*</code> |
| Runtime        | <code>@opencode-ai/plugin</code>         | <code>^1.18.34</code>    |
| Runtime        | <code>zod</code>                         | <code>^4.6.5</code>      |
| Development    | <code>@neottia/issues</code>             | <code>workspace:*</code> |
| Development    | <code>@neottia/repository-store</code>   | <code>workspace:*</code> |
| Development    | <code>@neottia/testkit</code>            | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>     | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>                 | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                  | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                      | <code>^5.0.3</code>      |

### <code>@neottia/opencode-issues</code>

| Declaration           | Exact value                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/opencode-issues/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/opencode-issues/package.json) |
| Version               | <code>0.2.4</code>                                                                                                                                |
| Private field         | <code>Not declared</code>                                                                                                                         |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                       |
| Platform declarations | None                                                                                                                                              |

| Classification | Dependency                               | Exact range              |
| -------------- | ---------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config-registry</code>    | <code>workspace:^</code> |
| Runtime        | <code>@neottia/issues</code>             | <code>workspace:*</code> |
| Runtime        | <code>@neottia/issues-design-docs</code> | <code>workspace:*</code> |
| Runtime        | <code>@neottia/opencode-adapter</code>   | <code>workspace:*</code> |
| Runtime        | <code>@opencode-ai/plugin</code>         | <code>^1.18.34</code>    |
| Development    | <code>@neottia/design-docs</code>        | <code>workspace:*</code> |
| Development    | <code>@neottia/testkit</code>            | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>     | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>                 | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                  | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                      | <code>^5.0.3</code>      |

### <code>@neottia/opencode-memory</code>

| Declaration           | Exact value                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/opencode-memory/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/opencode-memory/package.json) |
| Version               | <code>0.2.4</code>                                                                                                                                |
| Private field         | <code>Not declared</code>                                                                                                                         |
| Engines               | None                                                                                                                                              |
| Platform declarations | None                                                                                                                                              |

| Classification | Dependency                            | Exact range              |
| -------------- | ------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config-registry</code> | <code>workspace:^</code> |
| Runtime        | <code>@neottia/memory-core</code>     | <code>workspace:*</code> |
| Runtime        | <code>@opencode-ai/plugin</code>      | <code>^1.18.34</code>    |
| Runtime        | <code>zod</code>                      | <code>^4.6.5</code>      |
| Development    | <code>@neottia/testkit</code>         | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>  | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>              | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>               | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                   | <code>^5.0.3</code>      |

### <code>@neottia/opencode-searchable</code>

| Declaration           | Exact value                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/opencode-searchable/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/opencode-searchable/package.json) |
| Version               | <code>0.2.9</code>                                                                                                                                        |
| Private field         | <code>Not declared</code>                                                                                                                                 |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                               |
| Platform declarations | None                                                                                                                                                      |

| Classification | Dependency                             | Exact range              |
| -------------- | -------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config</code>           | <code>workspace:^</code> |
| Runtime        | <code>@neottia/config-registry</code>  | <code>workspace:^</code> |
| Runtime        | <code>@neottia/opencode-adapter</code> | <code>workspace:*</code> |
| Runtime        | <code>@neottia/searchable-core</code>  | <code>workspace:*</code> |
| Runtime        | <code>@opencode-ai/plugin</code>       | <code>^1.18.34</code>    |
| Development    | <code>@neottia/testkit</code>          | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>   | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>               | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                    | <code>^5.0.3</code>      |

### <code>@neottia/pi-adapter</code>

| Declaration           | Exact value                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/pi-adapter/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/pi-adapter/package.json) |
| Version               | <code>0.2.1</code>                                                                                                                      |
| Private field         | <code>Not declared</code>                                                                                                               |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                             |
| Platform declarations | None                                                                                                                                    |

| Classification | Dependency                            | Exact range              |
| -------------- | ------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/harness-adapter</code> | <code>workspace:^</code> |
| Development    | <code>@neottia/testkit</code>         | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>  | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>              | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>               | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                   | <code>^5.0.3</code>      |

### <code>@neottia/pi-design-docs</code>

| Declaration           | Exact value                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/pi-design-docs/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/pi-design-docs/package.json) |
| Version               | <code>0.2.4</code>                                                                                                                              |
| Private field         | <code>Not declared</code>                                                                                                                       |
| Engines               | None                                                                                                                                            |
| Platform declarations | None                                                                                                                                            |

| Classification | Dependency                               | Exact range              |
| -------------- | ---------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config-registry</code>    | <code>workspace:^</code> |
| Runtime        | <code>@neottia/design-docs</code>        | <code>workspace:*</code> |
| Runtime        | <code>@neottia/issues-design-docs</code> | <code>workspace:*</code> |
| Runtime        | <code>@neottia/pi-adapter</code>         | <code>workspace:*</code> |
| Runtime        | <code>typebox</code>                     | <code>^1.3.34</code>     |
| Development    | <code>@neottia/repository-store</code>   | <code>workspace:*</code> |
| Development    | <code>@neottia/testkit</code>            | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>     | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>                 | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                  | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                      | <code>^5.0.3</code>      |

### <code>@neottia/pi-issues</code>

| Declaration           | Exact value                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/pi-issues/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/pi-issues/package.json) |
| Version               | <code>0.2.4</code>                                                                                                                    |
| Private field         | <code>Not declared</code>                                                                                                             |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                           |
| Platform declarations | None                                                                                                                                  |

| Classification | Dependency                               | Exact range              |
| -------------- | ---------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config-registry</code>    | <code>workspace:^</code> |
| Runtime        | <code>@neottia/issues</code>             | <code>workspace:*</code> |
| Runtime        | <code>@neottia/issues-design-docs</code> | <code>workspace:*</code> |
| Runtime        | <code>@neottia/pi-adapter</code>         | <code>workspace:*</code> |
| Runtime        | <code>typebox</code>                     | <code>^1.3.34</code>     |
| Development    | <code>@neottia/design-docs</code>        | <code>workspace:*</code> |
| Development    | <code>@neottia/testkit</code>            | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>     | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>                 | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                  | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                      | <code>^5.0.3</code>      |

### <code>@neottia/pi-memory</code>

| Declaration           | Exact value                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/pi-memory/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/pi-memory/package.json) |
| Version               | <code>0.2.5</code>                                                                                                                    |
| Private field         | <code>Not declared</code>                                                                                                             |
| Engines               | None                                                                                                                                  |
| Platform declarations | None                                                                                                                                  |

| Classification | Dependency                            | Exact range              |
| -------------- | ------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config-registry</code> | <code>workspace:^</code> |
| Runtime        | <code>@neottia/memory-core</code>     | <code>workspace:*</code> |
| Runtime        | <code>@neottia/pi-adapter</code>      | <code>workspace:*</code> |
| Runtime        | <code>typebox</code>                  | <code>^1.3.34</code>     |
| Development    | <code>@neottia/testkit</code>         | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>  | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>              | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>               | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                   | <code>^5.0.3</code>      |

### <code>@neottia/pi-searchable</code>

| Declaration           | Exact value                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>extensions/pi-searchable/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/extensions/pi-searchable/package.json) |
| Version               | <code>0.2.9</code>                                                                                                                            |
| Private field         | <code>Not declared</code>                                                                                                                     |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                   |
| Platform declarations | None                                                                                                                                          |

| Classification | Dependency                            | Exact range              |
| -------------- | ------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config</code>          | <code>workspace:^</code> |
| Runtime        | <code>@neottia/config-registry</code> | <code>workspace:^</code> |
| Runtime        | <code>@neottia/pi-adapter</code>      | <code>workspace:*</code> |
| Runtime        | <code>@neottia/searchable-core</code> | <code>workspace:*</code> |
| Runtime        | <code>typebox</code>                  | <code>^1.3.34</code>     |
| Development    | <code>@neottia/testkit</code>         | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>  | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>              | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>               | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                   | <code>^5.0.3</code>      |

### <code>@neottia/release</code>

| Declaration           | Exact value                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/release/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/release/package.json) |
| Version               | <code>0.2.1</code>                                                                                                            |
| Private field         | <code>Not declared</code>                                                                                                     |
| Engines               | None                                                                                                                          |
| Platform declarations | None                                                                                                                          |

| Classification | Dependency                                 | Exact range                  |
| -------------- | ------------------------------------------ | ---------------------------- |
| Runtime        | <code>@neottia/claude-code-adapter</code>  | <code>workspace:0.3.0</code> |
| Runtime        | <code>@neottia/cli</code>                  | <code>workspace:0.9.0</code> |
| Runtime        | <code>@neottia/config</code>               | <code>workspace:0.2.0</code> |
| Runtime        | <code>@neottia/config-registry</code>      | <code>workspace:0.4.1</code> |
| Runtime        | <code>@neottia/core</code>                 | <code>workspace:0.1.0</code> |
| Runtime        | <code>@neottia/design-docs</code>          | <code>workspace:0.2.1</code> |
| Runtime        | <code>@neottia/design-docs-mcp</code>      | <code>workspace:0.2.3</code> |
| Runtime        | <code>@neottia/distribution</code>         | <code>workspace:0.2.1</code> |
| Runtime        | <code>@neottia/harness-adapter</code>      | <code>workspace:0.3.0</code> |
| Runtime        | <code>@neottia/issues</code>               | <code>workspace:0.2.1</code> |
| Runtime        | <code>@neottia/issues-design-docs</code>   | <code>workspace:0.2.1</code> |
| Runtime        | <code>@neottia/issues-mcp</code>           | <code>workspace:0.2.3</code> |
| Runtime        | <code>@neottia/memory-core</code>          | <code>workspace:0.3.2</code> |
| Runtime        | <code>@neottia/memory-mcp</code>           | <code>workspace:0.3.4</code> |
| Runtime        | <code>@neottia/opencode-adapter</code>     | <code>workspace:0.2.1</code> |
| Runtime        | <code>@neottia/opencode-design-docs</code> | <code>workspace:0.2.3</code> |
| Runtime        | <code>@neottia/opencode-issues</code>      | <code>workspace:0.2.4</code> |
| Runtime        | <code>@neottia/opencode-memory</code>      | <code>workspace:0.2.4</code> |
| Runtime        | <code>@neottia/opencode-searchable</code>  | <code>workspace:0.2.9</code> |
| Runtime        | <code>@neottia/pi-adapter</code>           | <code>workspace:0.2.1</code> |
| Runtime        | <code>@neottia/pi-design-docs</code>       | <code>workspace:0.2.4</code> |
| Runtime        | <code>@neottia/pi-issues</code>            | <code>workspace:0.2.4</code> |
| Runtime        | <code>@neottia/pi-memory</code>            | <code>workspace:0.2.5</code> |
| Runtime        | <code>@neottia/pi-searchable</code>        | <code>workspace:0.2.9</code> |
| Runtime        | <code>@neottia/repository-store</code>     | <code>workspace:0.3.4</code> |
| Runtime        | <code>@neottia/sdlc</code>                 | <code>workspace:0.6.0</code> |
| Runtime        | <code>@neottia/searchable-core</code>      | <code>workspace:0.2.6</code> |
| Runtime        | <code>@neottia/searchable-mcp</code>       | <code>workspace:0.2.8</code> |

### <code>@neottia/repository-store</code>

| Declaration           | Exact value                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/repository-store/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/repository-store/package.json) |
| Version               | <code>0.3.4</code>                                                                                                                              |
| Private field         | <code>Not declared</code>                                                                                                                       |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                     |
| Platform declarations | None                                                                                                                                            |

| Classification | Dependency                           | Exact range          |
| -------------- | ------------------------------------ | -------------------- |
| Runtime        | <code>node-gyp</code>                | <code>^13.0.2</code> |
| Optional       | <code>sigstore</code>                | <code>^4.1.1</code>  |
| Development    | <code>@templ-project/tsconfig</code> | <code>^0.4.2</code>  |
| Development    | <code>@types/node</code>             | <code>^26.6.4</code> |
| Development    | <code>typescript</code>              | <code>^5.9.3</code>  |
| Development    | <code>vitest</code>                  | <code>^5.0.3</code>  |

### <code>@neottia/sdlc</code>

| Declaration           | Exact value                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/sdlc/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/sdlc/package.json) |
| Version               | <code>0.6.0</code>                                                                                                      |
| Private field         | <code>Not declared</code>                                                                                               |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                             |
| Platform declarations | None                                                                                                                    |

| Classification | Dependency                            | Exact range              |
| -------------- | ------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config</code>          | <code>workspace:^</code> |
| Runtime        | <code>@neottia/design-docs</code>     | <code>workspace:^</code> |
| Runtime        | <code>@neottia/distribution</code>    | <code>workspace:^</code> |
| Runtime        | <code>@neottia/harness-adapter</code> | <code>workspace:^</code> |
| Runtime        | <code>@neottia/issues</code>          | <code>workspace:^</code> |
| Runtime        | <code>@neottia/memory-core</code>     | <code>workspace:^</code> |
| Runtime        | <code>@neottia/searchable-core</code> | <code>workspace:^</code> |
| Runtime        | <code>capitalize</code>               | <code>1.0.0</code>       |
| Runtime        | <code>esrever</code>                  | <code>0.2.0</code>       |
| Runtime        | <code>iconv-lite</code>               | <code>0.6.3</code>       |
| Runtime        | <code>is-plain-object</code>          | <code>2.0.4</code>       |
| Runtime        | <code>isobject</code>                 | <code>3.0.1</code>       |
| Runtime        | <code>levenshtein</code>              | <code>1.0.5</code>       |
| Runtime        | <code>locutus</code>                  | <code>3.0.36</code>      |
| Runtime        | <code>luxon</code>                    | <code>1.28.1</code>      |
| Runtime        | <code>pad</code>                      | <code>2.3.0</code>       |
| Runtime        | <code>regex-parser</code>             | <code>2.3.1</code>       |
| Runtime        | <code>runes</code>                    | <code>0.4.3</code>       |
| Runtime        | <code>snake-case</code>               | <code>2.1.0</code>       |
| Runtime        | <code>source-map</code>               | <code>0.6.1</code>       |
| Runtime        | <code>twig-lexer</code>               | <code>0.9.2</code>       |
| Runtime        | <code>zod</code>                      | <code>^4.6.5</code>      |
| Development    | <code>@templ-project/tsconfig</code>  | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>              | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>               | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                   | <code>^5.0.3</code>      |

### <code>@neottia/searchable-core</code>

| Declaration           | Exact value                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/searchable-core/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/searchable-core/package.json) |
| Version               | <code>0.2.6</code>                                                                                                                            |
| Private field         | <code>Not declared</code>                                                                                                                     |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                   |
| Platform declarations | None                                                                                                                                          |

| Classification | Dependency                             | Exact range              |
| -------------- | -------------------------------------- | ------------------------ |
| Runtime        | <code>@mozilla/readability</code>      | <code>^0.6.0</code>      |
| Runtime        | <code>@neottia/config</code>           | <code>workspace:^</code> |
| Runtime        | <code>@neottia/repository-store</code> | <code>workspace:*</code> |
| Runtime        | <code>jsdom</code>                     | <code>^30.1.1</code>     |
| Runtime        | <code>turndown</code>                  | <code>^7.2.4</code>      |
| Runtime        | <code>yaml</code>                      | <code>^2.9.1</code>      |
| Runtime        | <code>zod</code>                       | <code>^4.6.5</code>      |
| Development    | <code>@templ-project/tsconfig</code>   | <code>^0.4.2</code>      |
| Development    | <code>@types/jsdom</code>              | <code>^30.0.0</code>     |
| Development    | <code>@types/node</code>               | <code>^26.6.4</code>     |
| Development    | <code>@types/turndown</code>           | <code>^5.0.6</code>      |
| Development    | <code>typescript</code>                | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                    | <code>^5.0.3</code>      |

### <code>@neottia/searchable-mcp</code>

| Declaration           | Exact value                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/searchable-mcp/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/searchable-mcp/package.json) |
| Version               | <code>0.2.8</code>                                                                                                                          |
| Private field         | <code>Not declared</code>                                                                                                                   |
| Engines               | <code>node</code> <code>&gt;=22.16.0</code>                                                                                                 |
| Platform declarations | None                                                                                                                                        |

| Classification | Dependency                             | Exact range              |
| -------------- | -------------------------------------- | ------------------------ |
| Runtime        | <code>@modelcontextprotocol/sdk</code> | <code>^1.31.0</code>     |
| Runtime        | <code>@neottia/config</code>           | <code>workspace:^</code> |
| Runtime        | <code>@neottia/config-registry</code>  | <code>workspace:^</code> |
| Runtime        | <code>@neottia/searchable-core</code>  | <code>workspace:*</code> |
| Development    | <code>@neottia/testkit</code>          | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>   | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>               | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>                | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                    | <code>^5.0.3</code>      |

### <code>@neottia/testkit</code>

| Declaration           | Exact value                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [<code>packages/testkit/package.json</code>](https://github.com/dragoscirjan/neottia/blob/main/packages/testkit/package.json) |
| Version               | <code>0.1.0</code>                                                                                                            |
| Private field         | <code>true</code>                                                                                                             |
| Engines               | None                                                                                                                          |
| Platform declarations | None                                                                                                                          |

| Classification | Dependency                            | Exact range              |
| -------------- | ------------------------------------- | ------------------------ |
| Runtime        | <code>@neottia/config</code>          | <code>workspace:^</code> |
| Runtime        | <code>@neottia/config-registry</code> | <code>workspace:^</code> |
| Runtime        | <code>@neottia/design-docs</code>     | <code>workspace:*</code> |
| Runtime        | <code>@neottia/harness-adapter</code> | <code>workspace:^</code> |
| Runtime        | <code>@neottia/issues</code>          | <code>workspace:*</code> |
| Runtime        | <code>@neottia/memory-core</code>     | <code>workspace:*</code> |
| Development    | <code>@templ-project/tsconfig</code>  | <code>^0.4.2</code>      |
| Development    | <code>@types/node</code>              | <code>^26.6.4</code>     |
| Development    | <code>typescript</code>               | <code>^5.9.3</code>      |
| Development    | <code>vitest</code>                   | <code>^5.0.3</code>      |
