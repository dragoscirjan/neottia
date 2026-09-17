# Configure forge providers

Neottia ships compile-time instruction bundles for GitHub, GitLab, Gitea, and Forgejo. Each bundle supplies checksummed fragments for the existing Issues, Documents, and remote source-control slots. The lifecycle templates remain provider-neutral.

The compiler input includes only the fragments selected by `capabilities.*`. Each lifecycle template then renders only the slots that command uses. Omitted fragments do not enter the command body or its instruction-pack list.

## Support matrix

| Provider | Issues       | Documents       | Remote source control                                                            | User tool                                                 |
| -------- | ------------ | --------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| GitHub   | Supported    | Git-backed wiki | Pull requests, review, Actions checks, and releases                              | [`gh`](https://cli.github.com/manual/), with optional MCP |
| GitLab   | Supported    | Git-backed wiki | Merge requests, review, pipelines, and releases                                  | [`glab`](https://docs.gitlab.com/cli/), with optional MCP |
| Gitea    | Requires MCP | Unsupported     | Git fetch and push use Git. Pull requests, review, CI, and releases require MCP. | No built-in end-user CLI assumption                       |
| Forgejo  | Requires MCP | Unsupported     | Git fetch and push use Git. Pull requests, review, CI, and releases require MCP. | No built-in end-user CLI assumption                       |

GitHub documents local wiki editing in its [wiki guide](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages). GitLab documents its Git-backed wiki in the [GitLab wiki guide](https://docs.gitlab.com/user/project/wiki/).

Neottia has no built-in Gitea or Forgejo CLI route. Configure MCP for their Issues and remote source-control slots. Their Documents slots remain unsupported.

## Configure a connection

A selected forge needs an entry under `connections.forges`. `base_url` accepts an HTTP or HTTPS URL. It rejects embedded user information, query strings, fragments, and values over 8 KiB. Paths and trailing slashes are allowed for self-hosted installations.

HTTPS needs no transport setting. HTTP requires `allow_insecure_http: true` on the connection. This explicit opt-in adds an insecure-transport warning to each rendered fragment. Prefer HTTPS whenever the route sends credentials.

`credential_environment` is the name of an environment variable. It is not `${NAME}` and it never contains the credential value.

```yaml
version: 1
capabilities:
  issues:
    provider: github
  documents:
    provider: github
  source_control:
    local: git
    remote: github
    workspaces: true
connections:
  forges:
    github:
      base_url: https://github.com
      credential_environment: GITHUB_TOKEN
```

A GitLab Self-Managed connection uses the same fields:

```yaml
version: 1
capabilities:
  issues:
    provider: gitlab
  source_control:
    local: git
    remote: gitlab
connections:
  forges:
    gitlab:
      base_url: https://gitlab.example.com/platform/
      credential_environment: GITLAB_TOKEN
```

Unused connection entries do not enter compiler input or change generated checksums.

## Configure MCP

MCP configuration belongs to one provider capability. Each entry names the MCP server as the agent sees it and the executable that starts it. Both fields reject whitespace and command arguments.

```yaml
version: 1
capabilities:
  issues:
    provider: forgejo
  documents:
    provider: filesystem
  source_control:
    local: git
    remote: forgejo
connections:
  forges:
    forgejo:
      base_url: https://code.example.com
      credential_environment: FORGEJO_TOKEN
      mcp:
        issues:
          server: forgejo
          command: forgejo-mcp-server
        remote_source_control:
          server: forgejo
          command: forgejo-mcp-server
```

The accepted MCP keys are `issues`, `documents`, and `remote_source_control`. A configured MCP entry replaces the CLI or local-Git route for that capability. Remote source control still uses Git for fetch and push. Gitea and Forgejo require MCP for Issues and remote forge objects.

Neottia's doctor checks whether `command` exists on `PATH`. It cannot prove that Pi or OpenCode has registered `server`, or that the server exposes a required operation. Generated instructions require a read-only server and operation check before mutation. The agent stops with a configuration diagnostic when that check fails.

## Install and authenticate tools

Neottia does not install or authenticate tools.

For GitHub, install `gh` from the [GitHub CLI instructions](https://github.com/cli/cli#installation), authenticate it, and populate the environment variable named by `credential_environment`. The GitHub CLI also documents `gh auth login` and token-based authentication.

For GitLab, install `glab` from the [GitLab CLI installation guide](https://docs.gitlab.com/cli/), authenticate it with `glab auth login`, and populate the configured credential environment variable.

For MCP, install the configured command and register the named server in the target host. The server must expose read operations before Neottia-generated instructions permit it as a mutation tool.

Do not put tokens in `.neottia/config.yml`. The compiler stores only the environment-variable name in its context, provenance, and checksums.

## Mutation safety

Every forge fragment applies these rules:

1. Run non-mutating availability and access checks.
2. Choose exactly one available tool for the operation before mutation.
3. Send the mutation through that tool only.
4. Never retry the mutation through another tool after a timeout, error, or ambiguous response.
5. Verify the result with the chosen tool. Stop and reconcile durable evidence when the result remains unclear.

A push does not authorize a pull-request or merge-request merge. Preparing a release does not authorize publication. The Release lifecycle still requires explicit authorization for irreversible actions.

## Troubleshooting

`FORGE_CONNECTION_REQUIRED` means a selected provider has no matching `connections.forges.<provider>` entry.

`FORGE_CAPABILITY_UNSUPPORTED` means the selected bundle does not declare that capability. Gitea and Forgejo Documents currently produce this error.

`FORGE_MCP_REQUIRED` means Gitea or Forgejo Issues or remote source control lacks the matching MCP entry.

A doctor result for a missing `tool` means Git, `gh`, or `glab` is absent from `PATH`. A missing `configuration` result names the credential environment variable that must be populated. A missing `mcp-server` result names the MCP command and tells you which server registration to add.

If the executable checks pass but an agent cannot see the configured MCP server, inspect the Pi or OpenCode MCP configuration. Neottia deliberately stops rather than trying the mutation through another tool.
