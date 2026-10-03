# Shared configuration

## Initialize a project

The `neottia` CLI writes the smallest valid project configuration:

```sh
neottia init --harness pi
neottia init --harness opencode --harness pi
```

`--harness` is repeatable and accepts `pi` and `opencode`. Repeated values are ignored, and argument order does not change the result. `--preset` selects the initial configuration shape; `local` (the default) is the only supported preset. Run the command from the project root, or pass `--project DIR`.

Optional modules join the lifecycle only through an explicit opt-in. `--enable memory` (repeatable; Memory is the only supported module today) writes `modules.memory.enabled: true` and `capabilities.memory.provider: filesystem`:

```sh
neottia init --harness pi --enable memory
```

When `.neottia/config.yml` already exists, run `neottia init` without `--harness` to validate it. The command reports `Validated <path>` and changes nothing.

## Compile and install

```sh
neottia apply
neottia apply --harness pi
```

`apply` validates the project configuration, compiles the six lifecycle commands plus the shared operating-protocol skill for every configured harness, resolves exact runtime package versions from the built-in compatibility catalog for the enabled modules, and installs everything in one run. No plan file is produced.

Files you changed or created at generated paths are never overwritten. Each conflict is printed as a `WARN` line with its path and reason, skipped, and everything else still installs. `apply` exits non-zero when files were skipped so scripts notice; resolve or remove the named files and run `apply` again.

### Plan before apply

When you want to review every mutation before anything is written, compile the lifecycle into a saved plan and apply it explicitly:

```sh
neottia sdlc plan --harness pi --output plan.json --manifest manifest.json
neottia apply --plan plan.json
```

`sdlc plan` compiles the lifecycle from the project configuration exactly like `apply`, then writes the reviewable installation plan to `--output`. The plan records every mutation with its target path, content checksum, provenance, conflicts, and the reload notice. `--manifest` additionally saves the compiler manifest used for the plan; pass it to `neottia doctor --manifest` for prerequisite and receipt-drift diagnostics. When the lifecycle is already installed, the plan is an update plan; conflicts are listed and exit the command with code 2 until resolved or approved with `--approve <conflict-id>`.

Inspect the saved plan, then apply it exactly as reviewed:

```sh
neottia apply --plan plan.json
```

`apply --plan` verifies the plan digest and refuses any plan that was modified after it was saved. Re-running the same plan is a no-op, and uninstalling later starts from the receipt:

```sh
neottia uninstall --receipt .neottia/install/sdlc-pi.receipt.json --output uninstall.plan.json
neottia apply --plan uninstall.plan.json
```

Uninstall removes only the files and host-configuration entries owned by the receipt and leaves unrelated user-owned configuration untouched.

`neottia doctor` validates the configuration and reports missing runtime packages or uninstalled harnesses. It changes nothing.

`init` enables filesystem Issues and Design Docs, selects local Git with no remote provider, and adds one project installation target per selected harness. Each harness receives its own required SDLC role assignments, so contributors can use different harnesses in one repository. For `neottia init --harness opencode --harness pi`, the generated file is:

```yaml
version: 1
modules:
  issues:
    enabled: true
  design_docs:
    enabled: true
capabilities:
  issues:
    provider: filesystem
  documents:
    provider: filesystem
  source_control:
    local: git
    remote: false
    workspaces: false
harnesses:
  install:
    targets:
      - id: opencode
        scope: project
      - id: pi
        scope: project
agents:
  sdlc:
    opencode:
      planner: { agent: current }
      implementer: { agent: current }
      verifier: { agent: current }
      release-coordinator: { agent: current }
    pi:
      planner: { agent: current }
      implementer: { agent: current }
      verifier: { agent: current }
      release-coordinator: { agent: current }
```

Add or remove harness targets under `harnesses.install.targets`. Change providers under `capabilities`, customize the required roles under `agents.sdlc.<harness>`, and enable more modules under `modules` as described below.

Memory stays outside the lifecycle unless `capabilities.memory.provider` selects a provider (`filesystem` or `postgres`). A selected provider requires `modules.memory.enabled: true` and must match the Memory module's own `backend` setting; the compiler fails closed on a mismatch. When enabled, every compiled command carries durable-memory boundaries: read-only retrieval before planning or resuming work, checkpoint evidence recorded through the `memory_*` authority with exact ownership and revision evidence, and a durable outcome summary before a lifecycle run stops.

## Manual configuration

Put project configuration in `.neottia/config.yml`. The root requires `version: 1`; each package reads only its own module shard.

```yaml
version: 1
modules:
  memory:
    enabled: true
  issues:
    enabled: true
  design_docs:
    enabled: true
  searchable:
    enabled: true
```

Every shard is disabled by default. Enable Searchable only where its web access, canonical stash, and optional local Ollama calls are intended.

Values resolve in this order:

```text
explicit library override
listed environment binding
.neottia/config.yml
schema default
```

`NEOTTIA_CONFIG_FILE` selects another file. Each domain also has a package-specific file variable and a `NEOTTIA_CONFIG_<DOMAIN>_PATH` shard selector. Only environment variables listed on the domain configuration page work.

Use the generated schemas shipped with the packages for editor and CI validation:

- [Memory schema](https://github.com/dragoscirjan/neottia/blob/main/packages/memory-core/config.schema.json)
- [Issues schema](https://github.com/dragoscirjan/neottia/blob/main/packages/issues/config.schema.json)
- [Design Docs schema](https://github.com/dragoscirjan/neottia/blob/main/packages/design-docs/config.schema.json)
- [Searchable schema](https://github.com/dragoscirjan/neottia/blob/main/packages/searchable-core/config.schema.json)

Read the [Memory](/memory/configuration), [Issues](/issues/configuration), [Design Docs](/design-docs/configuration), or [Searchable](/searchable/configuration) reference for defaults and bindings.
