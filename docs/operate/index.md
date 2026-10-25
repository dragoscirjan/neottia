# Operate Neottia

Use these tasks after installation or when a project changes runtime, filesystem, harness, or configuration.

## Check project health

```sh
neottia doctor
```

Doctor validates configuration, installed harness assets, receipts, the native Repository Store backend, and the actual project filesystem. It changes nothing. Read [Doctor and platform diagnostics](/operate/doctor) for the report fields and CI form.

## Resolve a problem

Use the [troubleshooting guide](/operate/troubleshooting) when:

- `apply` reports a conflict;
- commands or tools do not appear in the host;
- Claude Code shows unapproved project MCP servers;
- a capability reports that it is disabled;
- Doctor rejects the runtime, architecture, or filesystem;
- a cache is stale or corrupt;
- a lease, revision, or interrupted transaction blocks work.

## Maintain repository data

- [Track canonical files and ignore disposable state](/guides/repository-files)
- [Back up and migrate records](/guides/backup-and-migration)
- [Verify upgrades and recover failures](/guides/upgrades-and-recovery)
- [Interpret security limits and structured errors](/guides/security-and-errors)
- [Inspect Repository Store guarantees and support](/repository-store)

## Update or remove an installation

Neottia uses checksummed receipts. Generate a reviewable plan before an advanced update or uninstall:

```sh
neottia uninstall \
  --receipt .neottia/install/sdlc-pi.receipt.json \
  --output uninstall.plan.json
neottia apply --plan uninstall.plan.json
```

Uninstall removes only receipt-owned content and restores exact content displaced through an approved conflict. See [distribution, receipts, and recovery](/distribution/).
