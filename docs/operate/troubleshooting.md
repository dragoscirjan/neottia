# Troubleshoot Neottia

Start with these two commands from the project root:

```sh
neottia doctor
neottia doctor --json
```

The human report gives remediation. The JSON report gives stable diagnostic codes for automation and issue reports.

## The CLI does not start

**Check:**

```sh
node --version
pnpm --version
command -v neottia
```

**Fix:** Use Node.js 22.20 or newer and pnpm 10 or newer. Reinstall `@neottia/cli` from a trusted registry. Claude Code runtime modules also need `npx` on `PATH`.

## `apply` reports a conflict

Neottia found an existing unowned path or a receipt-owned path that changed after installation. It skips the path and exits non-zero instead of overwriting it.

**Fix:**

1. Read every `WARN` path and reason.
2. Preserve or move operator-owned content.
3. If replacement is intentional, generate a reviewable plan and approve the exact conflict ID.
4. Apply the unchanged saved plan.

```sh
neottia sdlc plan \
  --harness pi \
  --output install.plan.json \
  --approve conflict.0123456789abcdef
neottia apply --plan install.plan.json
```

There is no wildcard approval and no force option.

## The host does not show `/plan`

**Check:** Run `neottia doctor`, then inspect the harness receipt under `.neottia/install/`.

**Fix by host:**

- **Pi:** restart Pi in the project and inspect project package settings.
- **OpenCode:** restart OpenCode and inspect its project plugin configuration.
- **Claude Code:** restart Claude Code, open `/mcp`, and approve each project server from `.mcp.json`.

Confirm that the host process uses the repository root as its working directory.

## A tool reports that its capability is disabled

**Check:** Inspect `.neottia/config.yml` for the matching `modules.*.enabled` value and capability provider.

**Fix:** Enable the module and select the matching provider, then run:

```sh
neottia init
neottia apply
neottia doctor
```

Memory provider and backend selections must agree. Searchable lifecycle use requires `capabilities.searchable.provider: web` and an enabled Searchable module.

## Doctor rejects the platform or filesystem

**Check:** Compare the report with the [certified tuples](/get-started/requirements#certified-repository-store-tuples).

**Fix:** Move the project to a supported local filesystem and runtime. Do not treat a network mount, removable device, unlisted Unix system, Windows arm64, FreeBSD arm64, or FreeBSD Bun as supported.

A matching filesystem name is not sufficient. The behavior probes must also pass.

## Native installation or integrity fails

- An **availability** failure may source-build when Python, Make, a C++17 compiler, and platform headers are available.
- An **integrity** failure stops installation or loading. Reinstall from a trusted package source and investigate altered or conflicting assets.

Do not disable digest, signature, attestation, source-commit, tuple, or workflow-identity checks.

## A cache is stale or corrupt

Canonical files are authoritative. Validate them before rebuilding a disposable SQLite projection.

Depending on the capability, remove or rebuild only:

- `.neottia/memory/index.db*`;
- `.neottia/cache/` database files.

Do not delete canonical Memory, Issues, Design Docs, or Searchable records. See [upgrades and recovery](/guides/upgrades-and-recovery).

## A lease blocks work

A live lease means another bounded mutation owns the authority path.

**Fix:** Wait for the owner to finish or inspect the reported owner evidence. Do not delete a live lease. If a process crashed, let Repository Store authenticate and recover the stale state.

## A revision is stale

Another writer changed the record after you read it.

**Fix:** Fetch the current record, compare the competing change, and retry with the new revision. Do not bypass the expected revision.

## An installation stopped during apply

Generate recovery from the affected receipt:

```sh
neottia recover --receipt .neottia/install/sdlc-pi.receipt.json
```

An active journal rolls back. A committed journal is cleaned up. Recovery stops when a path matches neither the recorded before-state nor intended after-state; preserve the journal and inspect the conflict.

## Searchable cannot reach the web

Check the selected provider, credential environment names, target URL policy, network access, and configured timeouts. Keep credentials in the environment, not in `.neottia/config.yml`. `web_stash` and local `web_grep` do not require a live search-provider request after content is supplied.

## Ask for help

Include:

- `neottia doctor --json` output with secrets removed;
- operating system, architecture, runtime version, and filesystem type;
- the exact command and stable error code;
- whether the failure is repeatable in a new temporary repository;
- relevant receipt or journal metadata, without credentials or private content.

Report reproducible defects in the [Neottia issue tracker](https://github.com/dragoscirjan/neottia/issues).
