# Doctor and platform diagnostics

Run Doctor from the repository that owns `.neottia/config.yml`:

```sh
neottia doctor
```

Use an explicit root when automation starts elsewhere:

```sh
neottia doctor --project /path/to/repository
```

## What Doctor checks

Doctor reports:

- configuration validity and enabled capabilities;
- expected lifecycle assets and installation receipt drift;
- operating system, architecture, and runtime support;
- installed native addon identity and integrity;
- filesystem type, locality, and write access;
- atomic no-replace publication;
- hard-link and stable identity behavior;
- file durability and namespace durability barriers.

The filesystem probe runs in a private temporary area below the selected project. Doctor removes the area before it returns. Unsupported runtime tuples fail before probe files are created.

## Machine-readable output

```sh
neottia doctor --json
```

The default project JSON report, without `--manifest`, uses deterministic formatting and omits machine-specific paths. Use it in CI to compare status and diagnostic codes. Do not parse the human prose.

## Interpret the result

- **Supported** — the certified tuple and behavior probes passed. This is the expected state for filesystem-backed capabilities.
- **Unsupported tuple** — move the workload to a certified runtime, architecture, operating system, and local filesystem. Do not bypass the check.
- **Missing native addon** — reinstall from a trusted package source. An availability failure may use a source build when build tools are present.
- **Integrity failure** — stop. Reinstallation or investigation is required; integrity failures do not fall back to a source build.
- **Receipt drift** — inspect changed generated files or host entries before updating. Neottia will not overwrite them automatically.
- **Probe failure** — treat the reported publication, identity, link, or durability behavior as unsupported even if the filesystem name looks familiar.

See the [certified matrix](/get-started/requirements#certified-repository-store-tuples), [Repository Store reference](/repository-store), and [troubleshooting guide](/operate/troubleshooting).
