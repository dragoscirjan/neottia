# @neottia/harness-adapter

`@neottia/harness-adapter` defines the immutable contract between Neottia compilers, installers, and host-specific adapters. It does not read configuration, inspect the machine, write files, install packages, or run a harness.

## Install

```sh
pnpm add @neottia/harness-adapter
```

## Compose adapters

```ts
import { createHarnessAdapterRegistry } from "@neottia/harness-adapter";
import { opencodeHarnessAdapter } from "@neottia/opencode-adapter";
import { piHarnessAdapter } from "@neottia/pi-adapter";

const registry = createHarnessAdapterRegistry([piHarnessAdapter, opencodeHarnessAdapter]);
registry.get("pi");
```

Create third-party adapters with `defineHarnessAdapter()`. The constructor snapshots the declaration, preserves method receivers, validates runtime requests and method-specific success values, and returns a frozen adapter. The registry applies the same constructor before storage and rejects duplicate adapter IDs. It has no built-in Pi or OpenCode switch, so another adapter can be released and injected without changing compiler or installer code.

## Contract

Every adapter declares all entries in `HOST_FEATURES`. A feature is either supported with explicit scopes and a projection type, or unsupported with a reason and no output projection.

Adapters return the discriminated `ProjectionResult<T>` union. A successful result has a detached, deeply frozen `value` and an empty diagnostics tuple. A failed result has no value and a non-empty tuple of typed, value-free diagnostics. Runtime wrappers reject results that contain both, neither, malformed diagnostics, unsafe symbolic paths, invalid projected files, malformed package or configuration plans, or invalid reload notices. Diagnostics and host-owned results must use the declaration's host ID.

Symbolic `TargetPath` values use `project`, `home`, or `xdg-config` anchors. The installer supplies absolute roots later. Adapters never resolve `HOME`, XDG variables, or the current directory.

`HostConfigPlan` contains ownership-aware `ensure-array-entry` and `ensure-object-entry` operations. It does not replace a host configuration file. The installer can review these operations before it parses and applies them.

## Projection inputs

- `PromptProjectionRequest` contains Markdown and portable metadata.
- `SkillProjectionRequest` produces an Agent Skills `SKILL.md` file.
- `ExtensionProjectionRequest` contains local TypeScript source.
- `AgentProjectionRequest` contains a host-neutral agent request. Unsupported hosts diagnose it.
- `PackageProjectionRequest` uses a logical Neottia module ID and exact version.
- `HostConfigRequest` activates a package or declares a local or remote MCP server.
- `ReloadRequest` asks the adapter for an informational reload or restart notice.

See the [harness adapter guide](../../docs/harnesses/adapters.md) for the Pi and OpenCode feature matrix and path tables.

Asset IDs use lowercase letters, numbers, and single hyphen separators. Skill names have a 64-character limit. Skill descriptions have a 1024-character limit, and optional compatibility text has a 500-character limit. Generated content must use LF line endings and cannot contain NUL characters.

`testedHostVersions` is evidence, not a compatibility range. Leave it empty unless a version-coupled test executes that exact host release.
