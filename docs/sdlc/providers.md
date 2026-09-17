# Configure provider instruction packs

Neottia ships compile-time instruction packs for GitHub, GitLab, Gitea, Forgejo, Bitbucket, Jira, and Confluence. Each pack supplies checksummed fragments for an existing Issues, Documents, or remote source-control slot. The lifecycle templates remain provider-neutral.

The compiler input includes only the connections and fragments selected by `capabilities.*`. Each lifecycle template renders only the slots that command uses. Omitted fragments do not enter the command body, provenance, or instruction-pack list.

## Support matrix

| Provider   | Issues         | Documents       | Remote source control                                                                              | User tool                                                 |
| ---------- | -------------- | --------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| GitHub     | Supported      | Git-backed wiki | Pull requests, review, Actions checks, and releases                                                | [`gh`](https://cli.github.com/manual/), with optional MCP |
| GitLab     | Supported      | Git-backed wiki | Merge requests, review, pipelines, and releases                                                    | [`glab`](https://docs.gitlab.com/cli/), with optional MCP |
| Gitea      | Requires MCP   | Unsupported     | Git handles fetch and push. MCP handles pull requests, review, CI, and releases.                   | No built-in end-user CLI assumption                       |
| Forgejo    | Requires MCP   | Unsupported     | Git handles fetch and push. MCP handles pull requests, review, CI, and releases.                   | No built-in end-user CLI assumption                       |
| Jira       | Requires MCP   | Not selectable  | Not selectable                                                                                     | Command-backed MCP                                        |
| Confluence | Not selectable | Requires MCP    | Not selectable                                                                                     | Command-backed MCP                                        |
| Bitbucket  | Not selectable | Not selectable  | Git handles fetch and push. MCP handles pull requests, review, pipelines, and deployment evidence. | Command-backed MCP                                        |

GitHub documents local wiki editing in its [wiki guide](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages). GitLab documents its Git-backed wiki in the [GitLab wiki guide](https://docs.gitlab.com/user/project/wiki/).

Neottia has no built-in Gitea or Forgejo CLI route. Configure MCP for their Issues and remote source-control slots. Their Documents slots remain unsupported.

The [official Atlassian MCP server](https://github.com/atlassian/atlassian-mcp-server) is the vetted Cloud route for Jira, Confluence, and Bitbucket. Its [tool reference](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/) documents Jira read, write, and search operations; Confluence read, write, and search operations; and Bitbucket pull-request, review, pipeline, deployment, branch, and commit operations. Bitbucket release publication is not a documented tool. Generated release guidance stops unless the configured MCP server exposes an explicit release operation.

The official server supports Atlassian Cloud. Bitbucket workspaces must belong to an Atlassian organization. Neottia does not claim Jira Data Center, Confluence Data Center, or Bitbucket Data Center parity. Use a reviewed MCP implementation that exposes the required operation, or stop with an unsupported-operation report.

## Configure connections

Each selected provider needs its own entry under `connections.forges`. Jira, Confluence, and Bitbucket do not share a mandatory Atlassian connection object. A project may select any one of them without configuring the other two.

`base_url` accepts an HTTP or HTTPS URL. It rejects embedded user information, query strings, fragments, and values over 8 KiB. Paths and trailing slashes are allowed for self-hosted installations.

HTTPS needs no transport setting. HTTP requires `allow_insecure_http: true` on the connection. This opt-in adds an insecure-transport warning to each rendered fragment. Prefer HTTPS whenever the route sends credentials.

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

MCP configuration belongs to one provider capability. Each entry names the MCP server as the agent sees it and the executable that starts or proxies it. Both fields reject whitespace and command arguments.

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

The accepted MCP keys are `issues`, `documents`, and `remote_source_control`. GitHub, GitLab, Gitea, and Forgejo accept the slots declared in the support matrix. Jira accepts only `issues`. Confluence accepts only `documents`. Bitbucket accepts only `remote_source_control`. The configuration loader rejects unrelated slots on those three product connections.

A configured MCP entry replaces the CLI or local-Git provider-object route for that capability. Remote source control still uses Git for fetch and push. Gitea and Forgejo require MCP for Issues and remote forge objects. Jira, Confluence, and Bitbucket require MCP for their single supported capability.

Neottia's doctor checks whether `command` exists on `PATH`. It cannot prove that Pi or OpenCode has registered `server`, or that the server exposes a required operation. Generated instructions require a read-only server and operation check before mutation. The agent stops with a configuration diagnostic when that check fails.

## Configure Jira, Confluence, and Bitbucket independently

This example selects all three products while keeping separate URLs and credential references. The entries reuse one registered official Atlassian MCP server, but they do not have to share a server or credential variable.

```yaml
version: 1
capabilities:
  issues:
    provider: jira
  documents:
    provider: confluence
  source_control:
    local: git
    remote: bitbucket
    workspaces: false
connections:
  forges:
    jira:
      base_url: https://example.atlassian.net
      credential_environment: JIRA_API_TOKEN
      mcp:
        issues:
          server: atlassian
          command: mcp-remote
    confluence:
      base_url: https://example.atlassian.net/wiki
      credential_environment: CONFLUENCE_API_TOKEN
      mcp:
        documents:
          server: atlassian
          command: mcp-remote
    bitbucket:
      base_url: https://bitbucket.org/example
      credential_environment: BITBUCKET_API_TOKEN
      mcp:
        remote_source_control:
          server: atlassian
          command: mcp-remote
```

Register `atlassian` against `https://mcp.atlassian.com/v2/mcp` as described in Atlassian's [setup guide](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/). Clients that need a local proxy can use `mcp-remote`. Tool installation, server registration, and authentication remain outside compilation.

Jira instructions preserve the site, project key, work item key, URL, and resulting status. They require field metadata and valid transitions before mutation.

Confluence instructions read the current content, space, parent, and version before mutation. They preserve the content ID, URL, version, and resulting status. They do not substitute repository files for a selected Confluence document.

Bitbucket instructions use local Git for fetch and push. The MCP route handles pull requests, review state, pipeline and deployment evidence, and release operations only when an explicit operation exists.

## Install and authenticate tools

Neottia does not install or authenticate tools.

For GitHub, install `gh` from the [GitHub CLI instructions](https://github.com/cli/cli#installation), authenticate it, and populate the environment variable named by `credential_environment`.

For GitLab, install `glab` from the [GitLab CLI installation guide](https://docs.gitlab.com/cli/), authenticate it with `glab auth login`, and populate the configured credential environment variable.

For MCP, install the configured command and register the named server in the target host. The server must expose read operations before Neottia-generated instructions permit it as a mutation tool. The official Atlassian server supports OAuth 2.1 and API token authentication. The example above uses explicit API-token environment names because Neottia records credential names, not values.

Do not put tokens in `.neottia/config.yml`. The compiler stores only the environment-variable name in its context, provenance, and checksums.

## Mutation safety

Every provider fragment applies these rules:

1. Run non-mutating availability and access checks.
2. Choose exactly one available tool for the operation before mutation.
3. Send the mutation through that tool only.
4. Never retry the mutation through another tool after a timeout, error, or ambiguous response.
5. Verify the result with the chosen tool. Stop and reconcile durable evidence when the result remains unclear.

A push does not authorize a pull-request or merge-request merge. Preparing a release does not authorize publication. The Release lifecycle still requires explicit authorization for irreversible actions.

## Troubleshooting

`FORGE_CONNECTION_REQUIRED` means a selected provider has no matching `connections.forges.<provider>` entry.

`FORGE_CAPABILITY_UNSUPPORTED` means the selected bundle does not declare that capability. Gitea and Forgejo Documents produce this error. The Jira, Confluence, and Bitbucket provider enums expose only their supported capability.

`FORGE_MCP_REQUIRED` means a required capability has no matching MCP entry. This applies to Gitea and Forgejo Issues and remote source control, Jira Issues, Confluence Documents, and Bitbucket remote source control.

A doctor result for a missing `tool` means Git, `gh`, or `glab` is absent from `PATH`. A missing `configuration` result names the credential environment variable that must be populated. A missing `mcp-server` result names the MCP command and tells you which server registration to add.

If executable checks pass but an agent cannot see the configured MCP server, inspect the Pi or OpenCode MCP configuration. Neottia stops rather than trying the mutation through another tool.
