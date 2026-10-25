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

| Declaration        | Exact value                                             |
| ------------------ | ------------------------------------------------------- |
| Root package       | `neottia-monorepo`                                      |
| Root version       | `Not declared`                                          |
| Root private field | `true`                                                  |
| Package manager    | `pnpm@10.28.2`                                          |
| Engines            | `node` `>=20.0.0`<br>`pnpm` `>=10.0.0`                  |
| pnpm overrides     | `vite` `>=6.4.3`<br>`vitest` `^5.0.3`<br>`zod` `^4.5.4` |

### Root package dependencies

| Classification | Dependency                     | Exact range |
| -------------- | ------------------------------ | ----------- |
| Development    | `@changesets/changelog-github` | `^1.0.0`    |
| Development    | `@changesets/cli`              | `^3.0.0`    |
| Development    | `@jscpd/badge-reporter`        | `^4.0.1`    |
| Development    | `@modelcontextprotocol/sdk`    | `^1.31.0`   |
| Development    | `@templ-project/eslint`        | `^1.3.0`    |
| Development    | `@templ-project/prettier`      | `^1.1.0`    |
| Development    | `@types/node`                  | `^26.6.4`   |
| Development    | `@vitest/coverage-v8`          | `^5.0.3`    |
| Development    | `esbuild`                      | `^0.28.2`   |
| Development    | `eslint`                       | `^10.11.0`  |
| Development    | `husky`                        | `^9.1.7`    |
| Development    | `import-sort-style-module`     | `^6.0.0`    |
| Development    | `jscpd`                        | `^5.4.0`    |
| Development    | `lint-staged`                  | `^17.6.0`   |
| Development    | `npm-run-all2`                 | `^9.0.3`    |
| Development    | `prettier`                     | `^3.9.9`    |
| Development    | `prettier-plugin-import-sort`  | `^0.0.7`    |
| Development    | `prettier-plugin-toml`         | `^2.0.6`    |
| Development    | `rimraf`                       | `^6.1.2`    |
| Development    | `tsx`                          | `^4.23.15`  |
| Development    | `typescript`                   | `^5.9.3`    |
| Development    | `vitepress`                    | `^1.6.4`    |
| Development    | `vitest`                       | `^5.0.3`    |
| Development    | `yaml`                         | `^2.9.1`    |

## Workspace module dependencies

Each module section lists its runtime, peer, optional, and package-local development declarations. Root development dependencies still apply to repository-wide tasks.

#### `@neottia/claude-code-adapter`

| Declaration           | Exact value                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`extensions/claude-code-adapter/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/claude-code-adapter/package.json) |
| Version               | `0.3.0`                                                                                                                                        |
| Private field         | `Not declared`                                                                                                                                 |
| Engines               | `node` `>=22.16.0`                                                                                                                             |
| Platform declarations | None                                                                                                                                           |

| Classification | Dependency                 | Exact range   |
| -------------- | -------------------------- | ------------- |
| Runtime        | `@neottia/harness-adapter` | `workspace:^` |
| Development    | `@neottia/testkit`         | `workspace:*` |
| Development    | `@templ-project/tsconfig`  | `^0.4.2`      |
| Development    | `@types/node`              | `^26.6.4`     |
| Development    | `typescript`               | `^5.9.3`      |
| Development    | `vitest`                   | `^5.0.3`      |

#### `@neottia/cli`

| Declaration           | Exact value                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/cli/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/cli/package.json) |
| Version               | `0.8.0`                                                                                                    |
| Private field         | `Not declared`                                                                                             |
| Engines               | `node` `>=22.20.0`                                                                                         |
| Platform declarations | None                                                                                                       |

| Classification | Dependency                     | Exact range   |
| -------------- | ------------------------------ | ------------- |
| Runtime        | `@neottia/claude-code-adapter` | `workspace:^` |
| Runtime        | `@neottia/config`              | `workspace:^` |
| Runtime        | `@neottia/config-registry`     | `workspace:^` |
| Runtime        | `@neottia/design-docs`         | `workspace:^` |
| Runtime        | `@neottia/distribution`        | `workspace:^` |
| Runtime        | `@neottia/harness-adapter`     | `workspace:^` |
| Runtime        | `@neottia/issues`              | `workspace:^` |
| Runtime        | `@neottia/memory-core`         | `workspace:^` |
| Runtime        | `@neottia/opencode-adapter`    | `workspace:^` |
| Runtime        | `@neottia/pi-adapter`          | `workspace:^` |
| Runtime        | `@neottia/repository-store`    | `workspace:^` |
| Runtime        | `@neottia/sdlc`                | `workspace:^` |
| Runtime        | `@neottia/searchable-core`     | `workspace:^` |
| Development    | `@templ-project/tsconfig`      | `^0.4.2`      |
| Development    | `@types/node`                  | `^26.6.4`     |
| Development    | `typescript`                   | `^5.9.3`      |
| Development    | `vitest`                       | `^5.0.3`      |

#### `@neottia/config`

| Declaration           | Exact value                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/config/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/config/package.json) |
| Version               | `0.2.0`                                                                                                          |
| Private field         | `Not declared`                                                                                                   |
| Engines               | `node` `>=22.16.0`                                                                                               |
| Platform declarations | None                                                                                                             |

| Classification | Dependency                | Exact range |
| -------------- | ------------------------- | ----------- |
| Runtime        | `yaml`                    | `^2.9.1`    |
| Runtime        | `zod`                     | `^4.6.5`    |
| Development    | `@templ-project/tsconfig` | `^0.4.2`    |
| Development    | `@types/node`             | `^26.6.4`   |
| Development    | `typescript`              | `^5.9.3`    |
| Development    | `vitest`                  | `^5.0.3`    |

#### `@neottia/config-registry`

| Declaration           | Exact value                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/config-registry/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/config-registry/package.json) |
| Version               | `0.4.0`                                                                                                                            |
| Private field         | `Not declared`                                                                                                                     |
| Engines               | `node` `>=22.16.0`                                                                                                                 |
| Platform declarations | None                                                                                                                               |

| Classification | Dependency                 | Exact range   |
| -------------- | -------------------------- | ------------- |
| Runtime        | `@neottia/config`          | `workspace:^` |
| Runtime        | `@neottia/design-docs`     | `workspace:^` |
| Runtime        | `@neottia/issues`          | `workspace:^` |
| Runtime        | `@neottia/memory-core`     | `workspace:^` |
| Runtime        | `@neottia/sdlc`            | `workspace:^` |
| Runtime        | `@neottia/searchable-core` | `workspace:^` |
| Runtime        | `zod`                      | `^4.6.5`      |
| Development    | `@templ-project/tsconfig`  | `^0.4.2`      |
| Development    | `@types/node`              | `^26.6.4`     |
| Development    | `typescript`               | `^5.9.3`      |
| Development    | `vitest`                   | `^5.0.3`      |

#### `@neottia/core`

| Declaration           | Exact value                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Manifest              | [`packages/core/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/core/package.json) |
| Version               | `0.1.0`                                                                                                      |
| Private field         | `Not declared`                                                                                               |
| Engines               | `node` `>=20.0.0`                                                                                            |
| Platform declarations | None                                                                                                         |

| Classification | Dependency                | Exact range |
| -------------- | ------------------------- | ----------- |
| Development    | `@templ-project/tsconfig` | `^0.4.2`    |
| Development    | `esbuild`                 | `^0.28.2`   |
| Development    | `eslint`                  | `^10.11.0`  |
| Development    | `npm-run-all2`            | `^9.0.3`    |
| Development    | `rimraf`                  | `^6.1.2`    |
| Development    | `tsx`                     | `^4.23.15`  |
| Development    | `typescript`              | `^5.9.3`    |
| Development    | `vitest`                  | `^5.0.3`    |

#### `@neottia/design-docs`

| Declaration           | Exact value                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/design-docs/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/design-docs/package.json) |
| Version               | `0.2.1`                                                                                                                    |
| Private field         | `Not declared`                                                                                                             |
| Engines               | `node` `>=22.16.0`                                                                                                         |
| Platform declarations | None                                                                                                                       |

| Classification | Dependency                  | Exact range   |
| -------------- | --------------------------- | ------------- |
| Runtime        | `@neottia/config`           | `workspace:^` |
| Runtime        | `@neottia/repository-store` | `workspace:^` |
| Runtime        | `commonmark`                | `^0.31.2`     |
| Runtime        | `yaml`                      | `^2.9.1`      |
| Runtime        | `zod`                       | `^4.6.5`      |
| Development    | `@templ-project/tsconfig`   | `^0.4.2`      |
| Development    | `@types/commonmark`         | `^0.27.10`    |
| Development    | `@types/node`               | `^26.6.4`     |
| Development    | `typescript`                | `^5.9.3`      |
| Development    | `vitest`                    | `^5.0.3`      |

#### `@neottia/design-docs-mcp`

| Declaration           | Exact value                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/design-docs-mcp/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/design-docs-mcp/package.json) |
| Version               | `0.2.3`                                                                                                                            |
| Private field         | `Not declared`                                                                                                                     |
| Engines               | `node` `>=22.16.0`                                                                                                                 |
| Platform declarations | None                                                                                                                               |

| Classification | Dependency                    | Exact range   |
| -------------- | ----------------------------- | ------------- |
| Runtime        | `@modelcontextprotocol/sdk`   | `^1.31.0`     |
| Runtime        | `@neottia/config`             | `workspace:^` |
| Runtime        | `@neottia/config-registry`    | `workspace:^` |
| Runtime        | `@neottia/design-docs`        | `workspace:*` |
| Runtime        | `@neottia/issues-design-docs` | `workspace:*` |
| Runtime        | `zod`                         | `^4.6.5`      |
| Development    | `@neottia/repository-store`   | `workspace:*` |
| Development    | `@templ-project/tsconfig`     | `^0.4.2`      |
| Development    | `@types/node`                 | `^26.6.4`     |
| Development    | `typescript`                  | `^5.9.3`      |
| Development    | `vitest`                      | `^5.0.3`      |

#### `@neottia/distribution`

| Declaration           | Exact value                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/distribution/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/distribution/package.json) |
| Version               | `0.2.1`                                                                                                                      |
| Private field         | `Not declared`                                                                                                               |
| Engines               | `node` `>=22.20.0`                                                                                                           |
| Platform declarations | None                                                                                                                         |

| Classification | Dependency                 | Exact range   |
| -------------- | -------------------------- | ------------- |
| Runtime        | `@neottia/harness-adapter` | `workspace:^` |
| Runtime        | `jsonc-parser`             | `^3.3.1`      |
| Runtime        | `skills`                   | `^1.7.0`      |
| Development    | `@templ-project/tsconfig`  | `^0.4.2`      |
| Development    | `@types/node`              | `^26.6.4`     |
| Development    | `typescript`               | `^5.9.3`      |
| Development    | `vitest`                   | `^5.0.3`      |

#### `@neottia/harness-adapter`

| Declaration           | Exact value                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/harness-adapter/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/harness-adapter/package.json) |
| Version               | `0.3.0`                                                                                                                            |
| Private field         | `Not declared`                                                                                                                     |
| Engines               | `node` `>=22.16.0`                                                                                                                 |
| Platform declarations | None                                                                                                                               |

| Classification | Dependency                | Exact range |
| -------------- | ------------------------- | ----------- |
| Development    | `@templ-project/tsconfig` | `^0.4.2`    |
| Development    | `@types/node`             | `^26.6.4`   |
| Development    | `typescript`              | `^5.9.3`    |
| Development    | `vitest`                  | `^5.0.3`    |

#### `@neottia/issues`

| Declaration           | Exact value                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/issues/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/issues/package.json) |
| Version               | `0.2.1`                                                                                                          |
| Private field         | `Not declared`                                                                                                   |
| Engines               | `node` `>=22.16.0`                                                                                               |
| Platform declarations | None                                                                                                             |

| Classification | Dependency                  | Exact range   |
| -------------- | --------------------------- | ------------- |
| Runtime        | `@neottia/config`           | `workspace:^` |
| Runtime        | `@neottia/repository-store` | `workspace:^` |
| Runtime        | `yaml`                      | `^2.9.1`      |
| Runtime        | `zod`                       | `^4.6.5`      |
| Development    | `@templ-project/tsconfig`   | `^0.4.2`      |
| Development    | `@types/node`               | `^26.6.4`     |
| Development    | `typescript`                | `^5.9.3`      |
| Development    | `vitest`                    | `^5.0.3`      |

#### `@neottia/issues-design-docs`

| Declaration           | Exact value                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/issues-design-docs/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/issues-design-docs/package.json) |
| Version               | `0.2.1`                                                                                                                                  |
| Private field         | `Not declared`                                                                                                                           |
| Engines               | `node` `>=22.16.0`                                                                                                                       |
| Platform declarations | None                                                                                                                                     |

| Classification | Dependency                  | Exact range   |
| -------------- | --------------------------- | ------------- |
| Runtime        | `@neottia/config`           | `workspace:^` |
| Runtime        | `@neottia/design-docs`      | `workspace:^` |
| Runtime        | `@neottia/issues`           | `workspace:^` |
| Runtime        | `@neottia/repository-store` | `workspace:^` |
| Development    | `@templ-project/tsconfig`   | `^0.4.2`      |
| Development    | `@types/node`               | `^26.6.4`     |
| Development    | `typescript`                | `^5.9.3`      |
| Development    | `vitest`                    | `^5.0.3`      |

#### `@neottia/issues-mcp`

| Declaration           | Exact value                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Manifest              | [`packages/issues-mcp/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/issues-mcp/package.json) |
| Version               | `0.2.3`                                                                                                                  |
| Private field         | `Not declared`                                                                                                           |
| Engines               | `node` `>=22.16.0`                                                                                                       |
| Platform declarations | None                                                                                                                     |

| Classification | Dependency                    | Exact range   |
| -------------- | ----------------------------- | ------------- |
| Runtime        | `@modelcontextprotocol/sdk`   | `^1.31.0`     |
| Runtime        | `@neottia/config`             | `workspace:^` |
| Runtime        | `@neottia/config-registry`    | `workspace:^` |
| Runtime        | `@neottia/issues`             | `workspace:*` |
| Runtime        | `@neottia/issues-design-docs` | `workspace:*` |
| Development    | `@neottia/design-docs`        | `workspace:*` |
| Development    | `@neottia/testkit`            | `workspace:*` |
| Development    | `@templ-project/tsconfig`     | `^0.4.2`      |
| Development    | `@types/node`                 | `^26.6.4`     |
| Development    | `typescript`                  | `^5.9.3`      |
| Development    | `vitest`                      | `^5.0.3`      |

#### `@neottia/memory-core`

| Declaration           | Exact value                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/memory-core/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/memory-core/package.json) |
| Version               | `0.3.2`                                                                                                                    |
| Private field         | `Not declared`                                                                                                             |
| Engines               | `node` `>=22.16.0`                                                                                                         |
| Platform declarations | None                                                                                                                       |

| Classification | Dependency                  | Exact range   |
| -------------- | --------------------------- | ------------- |
| Runtime        | `@neottia/config`           | `workspace:^` |
| Runtime        | `@neottia/repository-store` | `workspace:^` |
| Runtime        | `pg`                        | `^8.23.1`     |
| Runtime        | `yaml`                      | `^2.9.1`      |
| Runtime        | `zod`                       | `^4.6.5`      |
| Development    | `@templ-project/tsconfig`   | `^0.4.2`      |
| Development    | `@types/node`               | `^26.6.4`     |
| Development    | `@types/pg`                 | `^8.23.1`     |
| Development    | `typescript`                | `^5.9.3`      |
| Development    | `vitest`                    | `^5.0.3`      |

#### `@neottia/memory-mcp`

| Declaration           | Exact value                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Manifest              | [`packages/memory-mcp/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/memory-mcp/package.json) |
| Version               | `0.3.4`                                                                                                                  |
| Private field         | `Not declared`                                                                                                           |
| Engines               | `node` `>=22.16.0`                                                                                                       |
| Platform declarations | None                                                                                                                     |

| Classification | Dependency                  | Exact range   |
| -------------- | --------------------------- | ------------- |
| Runtime        | `@modelcontextprotocol/sdk` | `^1.31.0`     |
| Runtime        | `@neottia/config`           | `workspace:^` |
| Runtime        | `@neottia/config-registry`  | `workspace:^` |
| Runtime        | `@neottia/memory-core`      | `workspace:*` |
| Runtime        | `zod`                       | `^4.6.5`      |
| Development    | `@neottia/repository-store` | `workspace:^` |
| Development    | `@templ-project/tsconfig`   | `^0.4.2`      |
| Development    | `@types/node`               | `^26.6.4`     |
| Development    | `typescript`                | `^5.9.3`      |
| Development    | `vitest`                    | `^5.0.3`      |
| Development    | `yaml`                      | `^2.9.1`      |

#### `@neottia/opencode-adapter`

| Declaration           | Exact value                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`extensions/opencode-adapter/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/opencode-adapter/package.json) |
| Version               | `0.2.1`                                                                                                                                  |
| Private field         | `Not declared`                                                                                                                           |
| Engines               | `node` `>=22.16.0`                                                                                                                       |
| Platform declarations | None                                                                                                                                     |

| Classification | Dependency                 | Exact range   |
| -------------- | -------------------------- | ------------- |
| Runtime        | `@neottia/harness-adapter` | `workspace:^` |
| Development    | `@neottia/pi-adapter`      | `workspace:*` |
| Development    | `@neottia/testkit`         | `workspace:*` |
| Development    | `@templ-project/tsconfig`  | `^0.4.2`      |
| Development    | `@types/node`              | `^26.6.4`     |
| Development    | `typescript`               | `^5.9.3`      |
| Development    | `vitest`                   | `^5.0.3`      |

#### `@neottia/opencode-design-docs`

| Declaration           | Exact value                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manifest              | [`extensions/opencode-design-docs/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/opencode-design-docs/package.json) |
| Version               | `0.2.3`                                                                                                                                          |
| Private field         | `Not declared`                                                                                                                                   |
| Engines               | None                                                                                                                                             |
| Platform declarations | None                                                                                                                                             |

| Classification | Dependency                    | Exact range   |
| -------------- | ----------------------------- | ------------- |
| Runtime        | `@neottia/config-registry`    | `workspace:^` |
| Runtime        | `@neottia/design-docs`        | `workspace:*` |
| Runtime        | `@neottia/issues-design-docs` | `workspace:*` |
| Runtime        | `@opencode-ai/plugin`         | `^1.18.34`    |
| Runtime        | `zod`                         | `^4.6.5`      |
| Development    | `@neottia/issues`             | `workspace:*` |
| Development    | `@neottia/repository-store`   | `workspace:*` |
| Development    | `@neottia/testkit`            | `workspace:*` |
| Development    | `@templ-project/tsconfig`     | `^0.4.2`      |
| Development    | `@types/node`                 | `^26.6.4`     |
| Development    | `typescript`                  | `^5.9.3`      |
| Development    | `vitest`                      | `^5.0.3`      |

#### `@neottia/opencode-issues`

| Declaration           | Exact value                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`extensions/opencode-issues/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/opencode-issues/package.json) |
| Version               | `0.2.4`                                                                                                                                |
| Private field         | `Not declared`                                                                                                                         |
| Engines               | `node` `>=22.16.0`                                                                                                                     |
| Platform declarations | None                                                                                                                                   |

| Classification | Dependency                    | Exact range   |
| -------------- | ----------------------------- | ------------- |
| Runtime        | `@neottia/config-registry`    | `workspace:^` |
| Runtime        | `@neottia/issues`             | `workspace:*` |
| Runtime        | `@neottia/issues-design-docs` | `workspace:*` |
| Runtime        | `@neottia/opencode-adapter`   | `workspace:*` |
| Runtime        | `@opencode-ai/plugin`         | `^1.18.34`    |
| Development    | `@neottia/design-docs`        | `workspace:*` |
| Development    | `@neottia/testkit`            | `workspace:*` |
| Development    | `@templ-project/tsconfig`     | `^0.4.2`      |
| Development    | `@types/node`                 | `^26.6.4`     |
| Development    | `typescript`                  | `^5.9.3`      |
| Development    | `vitest`                      | `^5.0.3`      |

#### `@neottia/opencode-memory`

| Declaration           | Exact value                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`extensions/opencode-memory/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/opencode-memory/package.json) |
| Version               | `0.2.4`                                                                                                                                |
| Private field         | `Not declared`                                                                                                                         |
| Engines               | None                                                                                                                                   |
| Platform declarations | None                                                                                                                                   |

| Classification | Dependency                 | Exact range   |
| -------------- | -------------------------- | ------------- |
| Runtime        | `@neottia/config-registry` | `workspace:^` |
| Runtime        | `@neottia/memory-core`     | `workspace:*` |
| Runtime        | `@opencode-ai/plugin`      | `^1.18.34`    |
| Runtime        | `zod`                      | `^4.6.5`      |
| Development    | `@neottia/testkit`         | `workspace:*` |
| Development    | `@templ-project/tsconfig`  | `^0.4.2`      |
| Development    | `@types/node`              | `^26.6.4`     |
| Development    | `typescript`               | `^5.9.3`      |
| Development    | `vitest`                   | `^5.0.3`      |

#### `@neottia/opencode-searchable`

| Declaration           | Exact value                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`extensions/opencode-searchable/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/opencode-searchable/package.json) |
| Version               | `0.2.9`                                                                                                                                        |
| Private field         | `Not declared`                                                                                                                                 |
| Engines               | `node` `>=22.16.0`                                                                                                                             |
| Platform declarations | None                                                                                                                                           |

| Classification | Dependency                  | Exact range   |
| -------------- | --------------------------- | ------------- |
| Runtime        | `@neottia/config`           | `workspace:^` |
| Runtime        | `@neottia/config-registry`  | `workspace:^` |
| Runtime        | `@neottia/opencode-adapter` | `workspace:*` |
| Runtime        | `@neottia/searchable-core`  | `workspace:*` |
| Runtime        | `@opencode-ai/plugin`       | `^1.18.34`    |
| Development    | `@neottia/testkit`          | `workspace:*` |
| Development    | `@templ-project/tsconfig`   | `^0.4.2`      |
| Development    | `@types/node`               | `^26.6.4`     |
| Development    | `typescript`                | `^5.9.3`      |
| Development    | `vitest`                    | `^5.0.3`      |

#### `@neottia/pi-adapter`

| Declaration           | Exact value                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`extensions/pi-adapter/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/pi-adapter/package.json) |
| Version               | `0.2.1`                                                                                                                      |
| Private field         | `Not declared`                                                                                                               |
| Engines               | `node` `>=22.16.0`                                                                                                           |
| Platform declarations | None                                                                                                                         |

| Classification | Dependency                 | Exact range   |
| -------------- | -------------------------- | ------------- |
| Runtime        | `@neottia/harness-adapter` | `workspace:^` |
| Development    | `@neottia/testkit`         | `workspace:*` |
| Development    | `@templ-project/tsconfig`  | `^0.4.2`      |
| Development    | `@types/node`              | `^26.6.4`     |
| Development    | `typescript`               | `^5.9.3`      |
| Development    | `vitest`                   | `^5.0.3`      |

#### `@neottia/pi-design-docs`

| Declaration           | Exact value                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Manifest              | [`extensions/pi-design-docs/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/pi-design-docs/package.json) |
| Version               | `0.2.4`                                                                                                                              |
| Private field         | `Not declared`                                                                                                                       |
| Engines               | None                                                                                                                                 |
| Platform declarations | None                                                                                                                                 |

| Classification | Dependency                    | Exact range   |
| -------------- | ----------------------------- | ------------- |
| Runtime        | `@neottia/config-registry`    | `workspace:^` |
| Runtime        | `@neottia/design-docs`        | `workspace:*` |
| Runtime        | `@neottia/issues-design-docs` | `workspace:*` |
| Runtime        | `@neottia/pi-adapter`         | `workspace:*` |
| Runtime        | `typebox`                     | `^1.3.34`     |
| Development    | `@neottia/repository-store`   | `workspace:*` |
| Development    | `@neottia/testkit`            | `workspace:*` |
| Development    | `@templ-project/tsconfig`     | `^0.4.2`      |
| Development    | `@types/node`                 | `^26.6.4`     |
| Development    | `typescript`                  | `^5.9.3`      |
| Development    | `vitest`                      | `^5.0.3`      |

#### `@neottia/pi-issues`

| Declaration           | Exact value                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`extensions/pi-issues/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/pi-issues/package.json) |
| Version               | `0.2.4`                                                                                                                    |
| Private field         | `Not declared`                                                                                                             |
| Engines               | `node` `>=22.16.0`                                                                                                         |
| Platform declarations | None                                                                                                                       |

| Classification | Dependency                    | Exact range   |
| -------------- | ----------------------------- | ------------- |
| Runtime        | `@neottia/config-registry`    | `workspace:^` |
| Runtime        | `@neottia/issues`             | `workspace:*` |
| Runtime        | `@neottia/issues-design-docs` | `workspace:*` |
| Runtime        | `@neottia/pi-adapter`         | `workspace:*` |
| Runtime        | `typebox`                     | `^1.3.34`     |
| Development    | `@neottia/design-docs`        | `workspace:*` |
| Development    | `@neottia/testkit`            | `workspace:*` |
| Development    | `@templ-project/tsconfig`     | `^0.4.2`      |
| Development    | `@types/node`                 | `^26.6.4`     |
| Development    | `typescript`                  | `^5.9.3`      |
| Development    | `vitest`                      | `^5.0.3`      |

#### `@neottia/pi-memory`

| Declaration           | Exact value                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`extensions/pi-memory/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/pi-memory/package.json) |
| Version               | `0.2.5`                                                                                                                    |
| Private field         | `Not declared`                                                                                                             |
| Engines               | None                                                                                                                       |
| Platform declarations | None                                                                                                                       |

| Classification | Dependency                 | Exact range   |
| -------------- | -------------------------- | ------------- |
| Runtime        | `@neottia/config-registry` | `workspace:^` |
| Runtime        | `@neottia/memory-core`     | `workspace:*` |
| Runtime        | `@neottia/pi-adapter`      | `workspace:*` |
| Runtime        | `typebox`                  | `^1.3.34`     |
| Development    | `@neottia/testkit`         | `workspace:*` |
| Development    | `@templ-project/tsconfig`  | `^0.4.2`      |
| Development    | `@types/node`              | `^26.6.4`     |
| Development    | `typescript`               | `^5.9.3`      |
| Development    | `vitest`                   | `^5.0.3`      |

#### `@neottia/pi-searchable`

| Declaration           | Exact value                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`extensions/pi-searchable/package.json`](https://github.com/dragoscirjan/neottia/blob/main/extensions/pi-searchable/package.json) |
| Version               | `0.2.9`                                                                                                                            |
| Private field         | `Not declared`                                                                                                                     |
| Engines               | `node` `>=22.16.0`                                                                                                                 |
| Platform declarations | None                                                                                                                               |

| Classification | Dependency                 | Exact range   |
| -------------- | -------------------------- | ------------- |
| Runtime        | `@neottia/config`          | `workspace:^` |
| Runtime        | `@neottia/config-registry` | `workspace:^` |
| Runtime        | `@neottia/pi-adapter`      | `workspace:*` |
| Runtime        | `@neottia/searchable-core` | `workspace:*` |
| Runtime        | `typebox`                  | `^1.3.34`     |
| Development    | `@neottia/testkit`         | `workspace:*` |
| Development    | `@templ-project/tsconfig`  | `^0.4.2`      |
| Development    | `@types/node`              | `^26.6.4`     |
| Development    | `typescript`               | `^5.9.3`      |
| Development    | `vitest`                   | `^5.0.3`      |

#### `@neottia/release`

| Declaration           | Exact value                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Manifest              | [`packages/release/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/release/package.json) |
| Version               | `0.2.1`                                                                                                            |
| Private field         | `Not declared`                                                                                                     |
| Engines               | None                                                                                                               |
| Platform declarations | None                                                                                                               |

| Classification | Dependency                      | Exact range       |
| -------------- | ------------------------------- | ----------------- |
| Runtime        | `@neottia/claude-code-adapter`  | `workspace:0.3.0` |
| Runtime        | `@neottia/cli`                  | `workspace:0.8.0` |
| Runtime        | `@neottia/config`               | `workspace:0.2.0` |
| Runtime        | `@neottia/config-registry`      | `workspace:0.4.0` |
| Runtime        | `@neottia/core`                 | `workspace:0.1.0` |
| Runtime        | `@neottia/design-docs`          | `workspace:0.2.1` |
| Runtime        | `@neottia/design-docs-mcp`      | `workspace:0.2.3` |
| Runtime        | `@neottia/distribution`         | `workspace:0.2.1` |
| Runtime        | `@neottia/harness-adapter`      | `workspace:0.3.0` |
| Runtime        | `@neottia/issues`               | `workspace:0.2.1` |
| Runtime        | `@neottia/issues-design-docs`   | `workspace:0.2.1` |
| Runtime        | `@neottia/issues-mcp`           | `workspace:0.2.3` |
| Runtime        | `@neottia/memory-core`          | `workspace:0.3.2` |
| Runtime        | `@neottia/memory-mcp`           | `workspace:0.3.4` |
| Runtime        | `@neottia/opencode-adapter`     | `workspace:0.2.1` |
| Runtime        | `@neottia/opencode-design-docs` | `workspace:0.2.3` |
| Runtime        | `@neottia/opencode-issues`      | `workspace:0.2.4` |
| Runtime        | `@neottia/opencode-memory`      | `workspace:0.2.4` |
| Runtime        | `@neottia/opencode-searchable`  | `workspace:0.2.9` |
| Runtime        | `@neottia/pi-adapter`           | `workspace:0.2.1` |
| Runtime        | `@neottia/pi-design-docs`       | `workspace:0.2.4` |
| Runtime        | `@neottia/pi-issues`            | `workspace:0.2.4` |
| Runtime        | `@neottia/pi-memory`            | `workspace:0.2.5` |
| Runtime        | `@neottia/pi-searchable`        | `workspace:0.2.9` |
| Runtime        | `@neottia/repository-store`     | `workspace:0.3.4` |
| Runtime        | `@neottia/sdlc`                 | `workspace:0.5.1` |
| Runtime        | `@neottia/searchable-core`      | `workspace:0.2.6` |
| Runtime        | `@neottia/searchable-mcp`       | `workspace:0.2.8` |

#### `@neottia/repository-store`

| Declaration           | Exact value                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Manifest              | [`packages/repository-store/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/repository-store/package.json) |
| Version               | `0.3.4`                                                                                                                              |
| Private field         | `Not declared`                                                                                                                       |
| Engines               | `node` `>=22.16.0`                                                                                                                   |
| Platform declarations | None                                                                                                                                 |

| Classification | Dependency                | Exact range |
| -------------- | ------------------------- | ----------- |
| Runtime        | `node-gyp`                | `^13.0.2`   |
| Optional       | `sigstore`                | `^4.1.1`    |
| Development    | `@templ-project/tsconfig` | `^0.4.2`    |
| Development    | `@types/node`             | `^26.6.4`   |
| Development    | `typescript`              | `^5.9.3`    |
| Development    | `vitest`                  | `^5.0.3`    |

#### `@neottia/sdlc`

| Declaration           | Exact value                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Manifest              | [`packages/sdlc/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/sdlc/package.json) |
| Version               | `0.5.1`                                                                                                      |
| Private field         | `Not declared`                                                                                               |
| Engines               | `node` `>=22.16.0`                                                                                           |
| Platform declarations | None                                                                                                         |

| Classification | Dependency                 | Exact range   |
| -------------- | -------------------------- | ------------- |
| Runtime        | `@neottia/config`          | `workspace:^` |
| Runtime        | `@neottia/design-docs`     | `workspace:^` |
| Runtime        | `@neottia/distribution`    | `workspace:^` |
| Runtime        | `@neottia/harness-adapter` | `workspace:^` |
| Runtime        | `@neottia/issues`          | `workspace:^` |
| Runtime        | `@neottia/memory-core`     | `workspace:^` |
| Runtime        | `@neottia/searchable-core` | `workspace:^` |
| Runtime        | `capitalize`               | `1.0.0`       |
| Runtime        | `esrever`                  | `0.2.0`       |
| Runtime        | `iconv-lite`               | `0.6.3`       |
| Runtime        | `is-plain-object`          | `2.0.4`       |
| Runtime        | `isobject`                 | `3.0.1`       |
| Runtime        | `levenshtein`              | `1.0.5`       |
| Runtime        | `locutus`                  | `3.0.36`      |
| Runtime        | `luxon`                    | `1.28.1`      |
| Runtime        | `pad`                      | `2.3.0`       |
| Runtime        | `regex-parser`             | `2.3.1`       |
| Runtime        | `runes`                    | `0.4.3`       |
| Runtime        | `snake-case`               | `2.1.0`       |
| Runtime        | `source-map`               | `0.6.1`       |
| Runtime        | `twig-lexer`               | `0.9.2`       |
| Runtime        | `zod`                      | `^4.6.5`      |
| Development    | `@templ-project/tsconfig`  | `^0.4.2`      |
| Development    | `@types/node`              | `^26.6.4`     |
| Development    | `typescript`               | `^5.9.3`      |
| Development    | `vitest`                   | `^5.0.3`      |

#### `@neottia/searchable-core`

| Declaration           | Exact value                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/searchable-core/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/searchable-core/package.json) |
| Version               | `0.2.6`                                                                                                                            |
| Private field         | `Not declared`                                                                                                                     |
| Engines               | `node` `>=22.16.0`                                                                                                                 |
| Platform declarations | None                                                                                                                               |

| Classification | Dependency                  | Exact range   |
| -------------- | --------------------------- | ------------- |
| Runtime        | `@mozilla/readability`      | `^0.6.0`      |
| Runtime        | `@neottia/config`           | `workspace:^` |
| Runtime        | `@neottia/repository-store` | `workspace:*` |
| Runtime        | `jsdom`                     | `^30.1.1`     |
| Runtime        | `turndown`                  | `^7.2.4`      |
| Runtime        | `yaml`                      | `^2.9.1`      |
| Runtime        | `zod`                       | `^4.6.5`      |
| Development    | `@templ-project/tsconfig`   | `^0.4.2`      |
| Development    | `@types/jsdom`              | `^30.0.0`     |
| Development    | `@types/node`               | `^26.6.4`     |
| Development    | `@types/turndown`           | `^5.0.6`      |
| Development    | `typescript`                | `^5.9.3`      |
| Development    | `vitest`                    | `^5.0.3`      |

#### `@neottia/searchable-mcp`

| Declaration           | Exact value                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Manifest              | [`packages/searchable-mcp/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/searchable-mcp/package.json) |
| Version               | `0.2.8`                                                                                                                          |
| Private field         | `Not declared`                                                                                                                   |
| Engines               | `node` `>=22.16.0`                                                                                                               |
| Platform declarations | None                                                                                                                             |

| Classification | Dependency                  | Exact range   |
| -------------- | --------------------------- | ------------- |
| Runtime        | `@modelcontextprotocol/sdk` | `^1.31.0`     |
| Runtime        | `@neottia/config`           | `workspace:^` |
| Runtime        | `@neottia/config-registry`  | `workspace:^` |
| Runtime        | `@neottia/searchable-core`  | `workspace:*` |
| Development    | `@neottia/testkit`          | `workspace:*` |
| Development    | `@templ-project/tsconfig`   | `^0.4.2`      |
| Development    | `@types/node`               | `^26.6.4`     |
| Development    | `typescript`                | `^5.9.3`      |
| Development    | `vitest`                    | `^5.0.3`      |

#### `@neottia/testkit`

| Declaration           | Exact value                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Manifest              | [`packages/testkit/package.json`](https://github.com/dragoscirjan/neottia/blob/main/packages/testkit/package.json) |
| Version               | `0.1.0`                                                                                                            |
| Private field         | `true`                                                                                                             |
| Engines               | None                                                                                                               |
| Platform declarations | None                                                                                                               |

| Classification | Dependency                 | Exact range   |
| -------------- | -------------------------- | ------------- |
| Runtime        | `@neottia/config`          | `workspace:^` |
| Runtime        | `@neottia/config-registry` | `workspace:^` |
| Runtime        | `@neottia/design-docs`     | `workspace:*` |
| Runtime        | `@neottia/harness-adapter` | `workspace:^` |
| Runtime        | `@neottia/issues`          | `workspace:*` |
| Runtime        | `@neottia/memory-core`     | `workspace:*` |
| Development    | `@templ-project/tsconfig`  | `^0.4.2`      |
| Development    | `@types/node`              | `^26.6.4`     |
| Development    | `typescript`               | `^5.9.3`      |
| Development    | `vitest`                   | `^5.0.3`      |

## Freshness contract

Run `mise run docs:dependencies:generate` after a manifest changes. `mise run docs:check` compares this page with every current manifest and fails when the committed reference is stale.
