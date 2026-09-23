# @neottia/cli

`@neottia/cli` publishes the `neottia` command for initializing project configuration and reviewing and applying asset installation plans.

## Install

```sh
pnpm add --global @neottia/cli
```

## Commands

```sh
neottia init --harness pi|opencode [--harness pi|opencode]... [--project DIR]
neottia plan --manifest manifest.json --output install.plan.json
neottia apply --plan install.plan.json
neottia plan --action update --manifest manifest.json --output update.plan.json
neottia uninstall --receipt .neottia/install/default.receipt.json --output uninstall.plan.json
neottia doctor --manifest manifest.json
neottia recover --receipt .neottia/install/default.receipt.json
```

`init` writes the minimal `.neottia/config.yml` for the selected harnesses. `--harness` is repeatable, accepts `pi` and `opencode`, and the command never replaces an existing file. See the [configuration guide](../../docs/configuration.md) for the generated values.

`plan` prints the complete plan and can save the same JSON. `apply` accepts only a saved plan whose digest and checksums still match. If planning reports conflicts, approve each exact ID with a repeated `--approve <id>` option and generate the plan again. The CLI has no force option.

The CLI accepts `--project`, `--home`, `--xdg-config`, and `--xdg-state` on commands that inspect an installation. Defaults are resolved in the CLI before it calls the distribution library. Harness adapters receive no machine paths.

See the [distribution guide](../../docs/distribution/) for manifest production, ownership rules, configuration, and recovery.
