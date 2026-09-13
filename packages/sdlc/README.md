# @neottia/sdlc

`@neottia/sdlc` defines the provider selections that a future Neottia prompt compiler will consume. It does not parse YAML, render prompts, run provider operations, or install external tools. The [unified configuration guide](../../docs/configuration.md#sdlc-provider-selection) documents the project YAML contract.

## Configure provider selections

The shared resolver applies these defaults:

```yaml
version: 1
capabilities:
  issues:
    provider: filesystem
  documents:
    provider: filesystem
  source_control:
    local: git
    remote: false
    workspaces: false
```

Filesystem selections require their corresponding modules:

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
```

Enable a remote source-control selection by naming one supported forge:

```yaml
version: 1
capabilities:
  issues:
    provider: github
  documents:
    provider: confluence
  source_control:
    local: jj
    remote: bitbucket
    workspaces: false
```

## Provider status

This package validates provider identities and exposes them to the compiler. It does not claim that their instruction packs are installed.

| Capability            | Accepted providers                                                 | Current implementation status                                                             |
| --------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Issues                | `filesystem`, `github`, `gitlab`, `gitea`, `forgejo`, `jira`       | Filesystem module available; remote instruction packs are planned in issues #116 and #117 |
| Documents             | `filesystem`, `github`, `gitlab`, `gitea`, `forgejo`, `confluence` | Filesystem module available; remote instruction packs are planned in issues #116 and #117 |
| Local source control  | `git`, `jj`                                                        | Selection contract available; prompt compilation is planned in issue #115                 |
| Remote source control | `false`, `github`, `gitlab`, `gitea`, `forgejo`, `bitbucket`       | Disabled by default; instruction packs are planned in issues #116 and #117                |

Fixed provider facts do not belong in project configuration. Provider instruction packages will own command names and other fixed details.

## Create compiler input

Pass an existing snapshot that contains the official module and capability contributions:

```ts
import { resolveHostConfigSnapshot } from "@neottia/config-registry";
import { createSdlcCompilerContext } from "@neottia/sdlc";

const snapshot = resolveHostConfigSnapshot({
  cwd: process.cwd(),
  interactive: false,
});
export const context = createSdlcCompilerContext(snapshot);
```

`createSdlcCompilerContext()` reads only the supplied snapshot. It does not inspect environment variables or configuration files. The returned context and every nested object are frozen.

The function reports semantic conflicts with `SdlcConfigError`. Problems contain a stable code, a configuration path, and a value-free message. It rejects filesystem capabilities whose modules are disabled and rejects source-control workspaces when local source control is not Git.

`remote` is one atomic scalar. A profile can replace `github` with `false` without retaining settings from a lower configuration layer. Provider-specific URLs, credentials, and tools are outside this package.
