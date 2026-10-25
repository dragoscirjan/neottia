# Install Neottia in a repository

This path installs the shared lifecycle and the default Issues and Design Docs capabilities. It does not publish, merge, or change remote services.

## 1. Check the prerequisites

You need:

- Node.js 22.20 or newer;
- pnpm 10 or newer;
- a supported AI coding harness: Pi, OpenCode, or Claude Code;
- Git and a local certified filesystem for repository-backed data.

Read the [complete runtime and filesystem matrix](/get-started/requirements) if you use macOS, Windows, FreeBSD, containers, network storage, or a source build.

## 2. Install the CLI

```sh
pnpm add --global @neottia/cli
neottia --help
```

Run the remaining commands from the root of the repository that will own the lifecycle records.

## 3. Initialize one harness

Choose one command:

```sh
neottia init --harness pi
neottia init --harness opencode
neottia init --harness claude-code
```

To support more than one harness in the same repository, repeat the option in one command:

```sh
neottia init --harness pi --harness claude-code
```

The command creates `.neottia/config.yml`. Issues and Design Docs are enabled by default. Add Memory or Searchable only when you intend to use them:

```sh
neottia init --harness pi --enable memory --enable searchable
```

## 4. Compile and install

```sh
neottia apply
```

`apply` compiles six commands and the shared operating-protocol skill for every configured harness. It also writes host configuration entries that reference the exact runtime packages required by enabled modules. Each host fetches those packages during its own startup, trust, or launch step.

Neottia does not overwrite an unowned or modified file. If `apply` reports a conflict, inspect the named path and follow the [conflict procedure](/operate/troubleshooting#apply-reports-a-conflict).

## 5. Run diagnostics

```sh
neottia doctor
```

A successful report confirms the configuration, installation receipts, native backend, and required filesystem behavior. Doctor changes nothing and removes its temporary probe area before it returns.

## 6. Reload the host

| Harness     | Finish setup                                                                        |
| ----------- | ----------------------------------------------------------------------------------- |
| Pi          | Restart Pi in the project and confirm that `/plan` is available.                    |
| OpenCode    | Restart OpenCode in the project and confirm that `/plan` is available.              |
| Claude Code | Restart Claude Code, open `/mcp`, and approve each project server from `.mcp.json`. |

Now complete the [first successful lifecycle operation](/get-started/first-success).

## What was installed?

The exact paths differ by harness, but the installation contains:

- `/plan`, `/build`, `/verify`, `/release`, `/continue`, and `/refresh`;
- the `neottia-sdlc` operating-protocol skill;
- runtime package or MCP entries for enabled capabilities;
- a receipt under `.neottia/install/` that records ownership and checksums.

See [distribution and receipts](/distribution/) for plan-first installation, updates, uninstall, and recovery.
