# Issues configuration

Issues contributes the strict `modules.issues` shard to the shared `@neottia/config` resolver. Unknown keys are rejected. The older `skills.issues` path remains available through `loadIssueConfig()` during migration, but new configuration should use the canonical path.

```yaml
version: 1
modules:
  issues:
    enabled: true
    root: .neottia/issues
    prefix: issue-
    retrieval:
      limit: 20
      max_bytes: 1048576
    cache:
      max_age_ms: 300000
      stale_policy: prompt
    lock:
      wait_ms: 10000
      stale_ms: 60000
    security:
      max_file_bytes: 1048576
      max_files: 10000
      max_total_bytes: 67108864
      max_batch_paths: 1000
      max_query_bytes: 16384
      max_query_rows: 10000
      max_result_bytes: 16777216
```

## Sources and precedence

The shared resolver reads optional global and project documents:

- Linux: `$XDG_CONFIG_HOME/neottia/config.yml`, or `~/.config/neottia/config.yml`;
- macOS: `$XDG_CONFIG_HOME/neottia/config.yml`, or `~/Library/Application Support/neottia/config.yml`;
- Windows: `%APPDATA%\neottia\config.yml`;
- project: `<cwd>/.neottia/config.yml`.

Every present document must declare the exact integer `version: 1`. Default files are optional. A path explicitly selected with `NEOTTIA_GLOBAL_CONFIG_FILE` or `NEOTTIA_CONFIG_FILE` must exist. Select one profile with `NEOTTIA_PROFILE` or the shared resolver API.

Values resolve once in this order:

```text
defaults < global file < project file < selected global profile
< selected project profile < environment < explicit runtime overrides
```

Each file and profile patch is validated before merging, so a higher-precedence value cannot hide an invalid lower layer. Object mappings merge recursively; arrays and scalar values replace lower layers.

`loadIssueConfig(cwd, options)` is the standalone compatibility wrapper. It also supports the deprecated `NEOTTIA_ISSUES_CONFIG_FILE` file selector, `NEOTTIA_CONFIG_ISSUES_PATH` arbitrary shard selector, and `skills.issues` alias. The wrapper ignores unrelated root paths for compatibility. A shared multi-module registry validates all paths strictly and rejects a source that declares both `modules.issues` and `skills.issues`.

## Options and safety limits

Options include `enabled`, safe project-relative `root`, portable `prefix`, retrieval limits, cache maximum age/stale policy, lease wait/stale bounds, and filesystem/query/result resource ceilings. The default root is `.neottia/issues`, prefix is `issue-`, and stale policy is `prompt` (non-interactive adapters rebuild). Explicit `fail` is never replaced by an adapter.

Root components may not end in a period. The `.neottia` control root and roots case-insensitively equal to or beneath `.neottia/cache` or `.neottia/repository-store` are rejected; near matches such as `.neottia/cache-x` remain valid. Runtime validation and the published `config.schema.json` enforce the same constraints. Disabled tools reject before roots, leases, or cache files are created.

## Environment bindings

Environment values override file and profile values, while explicit library values override environment values. Empty values are treated as unset. Booleans accept trimmed, case-insensitive `true`, `false`, `1`, or `0`; integers accept trimmed base-10 integer syntax. Invalid values fail with the variable name and configuration path.

| Variable                             | Configuration path          |
| ------------------------------------ | --------------------------- |
| `NEOTTIA_ISSUES_ENABLED`             | `enabled`                   |
| `NEOTTIA_ISSUES_ROOT`                | `root`                      |
| `NEOTTIA_ISSUES_PREFIX`              | `prefix`                    |
| `NEOTTIA_ISSUES_RETRIEVAL_LIMIT`     | `retrieval.limit`           |
| `NEOTTIA_ISSUES_RETRIEVAL_MAX_BYTES` | `retrieval.max_bytes`       |
| `NEOTTIA_ISSUES_CACHE_MAX_AGE_MS`    | `cache.max_age_ms`          |
| `NEOTTIA_ISSUES_CACHE_STALE_POLICY`  | `cache.stale_policy`        |
| `NEOTTIA_ISSUES_LOCK_WAIT_MS`        | `lock.wait_ms`              |
| `NEOTTIA_ISSUES_LOCK_STALE_MS`       | `lock.stale_ms`             |
| `NEOTTIA_ISSUES_MAX_FILE_BYTES`      | `security.max_file_bytes`   |
| `NEOTTIA_ISSUES_MAX_FILES`           | `security.max_files`        |
| `NEOTTIA_ISSUES_MAX_TOTAL_BYTES`     | `security.max_total_bytes`  |
| `NEOTTIA_ISSUES_MAX_BATCH_PATHS`     | `security.max_batch_paths`  |
| `NEOTTIA_ISSUES_MAX_QUERY_BYTES`     | `security.max_query_bytes`  |
| `NEOTTIA_ISSUES_MAX_QUERY_ROWS`      | `security.max_query_rows`   |
| `NEOTTIA_ISSUES_MAX_RESULT_BYTES`    | `security.max_result_bytes` |

## Shared snapshots and direct embedding

Register `issueConfigContribution` with other domain contributions and resolve one immutable snapshot for the effective working directory:

```ts
import { createConfigRegistry, resolveConfig } from "@neottia/config";
import { IssueStore, issueConfigContribution } from "@neottia/issues";

const registry = createConfigRegistry([issueConfigContribution]);
const snapshot = resolveConfig(registry, { cwd: process.cwd(), env: process.env });
export const store = new IssueStore(snapshot.get(issueConfigContribution), process.cwd());
```

`IssueStore` still accepts an explicit typed `IssueConfig`, so embedders do not need a file or shared resolver. `loadIssueConfig()` remains synchronous and returns the same standalone type. The package exports default-free `issueConfigFilePatchSchema` and `issueConfigRuntimePatchSchema` for composition, plus `issueConfigSchema` and `issueConfigFileSchema` for complete values.

To migrate an existing file, move the mapping without changing its fields:

```yaml
# Deprecated
version: 1
skills:
  issues: { enabled: true }
```

```yaml
# Canonical
version: 1
modules:
  issues: { enabled: true }
```

Do not declare both paths in one source; the resolver reports a collision rather than selecting one. The shipped [JSON Schema](https://github.com/dragoscirjan/neottia/blob/main/packages/issues/config.schema.json) is the machine-readable standalone reference.
