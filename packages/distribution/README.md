# @neottia/distribution

`@neottia/distribution` turns generated harness assets into reviewable installation plans. It applies authorized plans with ownership receipts, exact checksum checks, a transaction journal, and rollback.

The package does not choose SDLC providers, authenticate providers, or install missing external tools.

## Install

```sh
pnpm add @neottia/distribution
```

Node.js 22.20 or newer is required because the bundled `skills` package has the same minimum version.

## Workflow

1. Resolve templates with `resolveTemplates()`.
2. Project prompts, skills, extensions, agents, packages, and MCP settings through a `HarnessAdapter`.
3. Build a checksummed `AssetManifest` with `createAssetManifest()`.
4. Call `inspectInstallation()` to read targets and the current receipt.
5. Call `createInstallationPlan()` to produce a pure, serializable plan.
6. Review every mutation and conflict.
7. Call `authorizePlan()` with exact conflict IDs. There is no wildcard approval.
8. Call `applyInstallationPlan()`.

Use `inspectUninstall()` and `createInstallationPlan(snapshot, "uninstall")` to remove receipt-owned units and restore approved displaced content.

## Ownership

Receipts record the target, owner, source, version, checksum, and original state for each unit. Files are owned as complete files. Host configuration is owned per package identity or MCP object key, not as a complete settings file.

An existing unit without a receipt always produces an `unowned-existing` conflict, even when its bytes match the desired output. A receipt-owned unit whose checksum changed produces a `modified-owned` conflict. Both require approval by exact conflict ID.

Project receipts are stored under `<project>/.neottia/install/`. Global receipts are stored under `<xdg-state>/neottia/install/`. Receipts can contain displaced operator content needed by uninstall, so the transaction writer uses mode `0600` for new files.

## Transactions and recovery

Apply acquires an installation lock, verifies every complete containing-file checksum, writes a journal with before-images, publishes through same-directory temporary files, writes the receipt, and marks the journal committed. A normal failure restores changes in reverse order.

Call `recoverInstallation(receiptPath)` after an interrupted process. An active journal rolls back only paths that still match the recorded before-state or intended after-state. A committed journal requires cleanup only. Unexpected changes stop recovery and preserve the journal.

## Templates

`resolveTemplates()` accepts explicit layers at four fixed tiers:

1. `packaged`
2. `package`
3. `global`
4. `project`

Higher tiers replace complete template files. Duplicate IDs within one tier fail. Installed template packages must be listed explicitly; the resolver never scans `node_modules`.

Use `loadTemplateLayer()` to read an explicit source manifest. Each manifest maps a stable template ID to a relative file and SHA-256 checksum. The loader rejects path escapes, symbolic links, checksum mismatches, and sources above its byte limit before `resolveTemplates()` applies precedence.

## Static third-party skills

`stageExternalSkills()` runs the direct `skills` dependency in an isolated temporary project with isolated home and XDG directories. It requests the universal copy target, rejects links and special files, checks file and byte limits, verifies the configured directory digest, and converts every regular file into adapter-targeted manifest assets. The external tool never writes the final Pi or OpenCode destination.

## Host configuration

Adapter `ensure-array-entry` and `ensure-object-entry` operations are applied with JSONC edits. Comments and unrelated settings remain in place. If more than one adapter configuration candidate exists, inspection fails instead of selecting one.

## Doctor

`runDoctor()` checks declared commands, packages, paths, and environment variables. `diagnoseSnapshot()` reports receipt drift and pending transaction recovery. Both functions return instructions and never install prerequisites.

See the [distribution guide](../../docs/distribution/) for CLI commands, configuration, receipts, and recovery.
