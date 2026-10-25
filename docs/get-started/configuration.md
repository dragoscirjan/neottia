# Configure the first installation

For most repositories, let the CLI write the initial configuration. Use the full [configuration reference](/configuration) only when you need custom providers, roles, profiles, or module settings.

## Create the smallest valid project file

```sh
neottia init --harness pi
```

`--harness` is repeatable and accepts `pi`, `opencode`, and `claude-code`. The command writes `.neottia/config.yml` with:

- filesystem Issues and Design Docs enabled;
- local Git selected;
- remote source control disabled;
- project-scope installation targets;
- the current agent assigned to the four required lifecycle roles.

A project for Pi and Claude Code starts like this:

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
      - id: pi
        scope: project
      - id: claude-code
        scope: project
agents:
  sdlc:
    pi:
      planner: { agent: current }
      implementer: { agent: current }
      verifier: { agent: current }
      release-coordinator: { agent: current }
    claude-code:
      planner: { agent: current }
      implementer: { agent: current }
      verifier: { agent: current }
      release-coordinator: { agent: current }
```

## Enable optional capabilities

Enable Memory or Searchable during initialization:

```sh
neottia init --harness pi --enable memory --enable searchable
```

Memory uses the filesystem provider by default. Searchable enables the bounded web capability and canonical page stash. Configure credentials only for the search provider that you choose.

## Apply the configuration

```sh
neottia apply
```

`apply` validates the complete file, compiles the lifecycle for each target, resolves exact runtime package versions from the built-in compatibility catalog, and installs receipt-owned assets.

To review every mutation first, use a saved plan:

```sh
neottia sdlc plan --harness pi --output plan.json --manifest manifest.json
neottia apply --plan plan.json
```

The apply step verifies the plan digest. A modified plan is rejected.

## Change an existing project

Edit `.neottia/config.yml`, then run:

```sh
neottia init
neottia apply
neottia doctor
```

With no `--harness`, `init` validates the existing file and changes nothing. `apply` updates only receipt-owned assets and reports conflicts instead of overwriting operator changes.

## Configuration boundaries

- Neottia never stores credential values in the project file. Secret fields contain environment references such as `${GITHUB_TOKEN}`.
- Claude Code runtime modules are project-scoped in `.mcp.json`. Neottia does not edit `~/.claude.json`.
- Provider selection does not authenticate, grant permissions, or authorize remote mutations.
- Generated commands do not bypass host approval prompts.

Continue with [first success](/get-started/first-success), or open the [complete configuration reference](/configuration).
