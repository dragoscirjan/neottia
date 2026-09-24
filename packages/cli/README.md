# @neottia/cli

`@neottia/cli` publishes the `neottia` command for initializing project configuration, compiling the SDLC lifecycle from that configuration, and installing it into the selected harnesses.

## Install

```sh
pnpm add --global @neottia/cli
```

## Workflow commands

```sh
neottia init [--harness pi|opencode]... [--project DIR]
neottia apply [--harness ID]... [--scope project|global] [--project DIR]
neottia doctor [--project DIR]
```

`init` writes the minimal `.neottia/config.yml` for the selected harnesses. `--harness` is repeatable and accepts `pi` and `opencode`. When the file already exists and no `--harness` is given, `init` validates it and leaves every value untouched. See the [configuration guide](../../docs/configuration.md) for the generated values.

`apply` validates the project configuration, compiles the six lifecycle commands plus the shared operating-protocol skill for every configured harness (or the ones selected with repeatable `--harness`), resolves exact runtime package versions from the built-in compatibility catalog for the enabled modules, and installs everything in one run. No plan file is produced. Conflicting files (present but unowned, or modified after a previous install) are not overwritten: each one is reported as a `WARN` line with its path and reason, skipped, and everything else still installs. The command exits non-zero when files were skipped, prints a remediation summary, and never resolves package versions from a registry.

`doctor` validates the configuration and statically reports, per enabled module, whether the catalog has a compatible runtime package, and per harness whether the lifecycle is installed. It changes nothing and requires no manifest.

## Advanced manifest commands

```sh
neottia plan --manifest manifest.json --output install.plan.json
neottia apply --plan install.plan.json
neottia plan --action update --manifest manifest.json --output update.plan.json
neottia uninstall --receipt .neottia/install/default.receipt.json --output uninstall.plan.json
neottia doctor --manifest manifest.json
neottia recover --receipt .neottia/install/default.receipt.json
```

These commands drive the release pipeline, where a compiler-produced `AssetManifest` already exists. `plan` prints the complete plan and can save the same JSON. `apply --plan` accepts only a saved plan whose digest and checksums still match. If planning reports conflicts, approve each exact ID with a repeated `--approve <id>` option and generate the plan again. The CLI has no force option.

## Paths

The CLI accepts `--project`, `--home`, `--xdg-config`, and `--xdg-state` on commands that inspect an installation. Defaults are resolved in the CLI before it calls the distribution library. Harness adapters receive no machine paths.

See the [distribution guide](../../docs/distribution/) for manifest production, ownership rules, configuration, and recovery.
