# GDScript initialization rules

Prerequisite: Read [project foundation](project.md) first. If already loaded for this task, do not read it again. The approved mise/Node/pnpm foundation must already exist; missing foundation setup requires separate approval.

## Engine and project shape

- Establish exact Godot release/distribution, renderer, export targets, app/addon shape, first-party source paths, import policy, test framework, and headless availability.
- Match documentation and gdtoolkit support to that engine version. Do not initialize across an incompatible Godot major or import/upgrade scenes merely to inspect them.
- The [helper](../scripts/gdscript/init.ts) requires an existing `project.godot`. It adds baseline tooling, not a new Godot project, test addon, or export preset.

## Tool ownership and tasks

- Mise owns exact standalone Godot, Python, and uv versions; verify registry/platform/distribution support. `pyproject.toml` and `uv.lock` own `gdtoolkit`, not mise. Preserve existing Python tooling and addon managers.
- The generated parser helper uses Node from the shared control plane, not Bun. With source `.`, it skips `.git`, `.godot`, `.venv`, `node_modules`, addons, coverage, distribution, and build directories before checking symlinks; prefer a narrower first-party path.
- Namespaced tasks include `deps:sync:gdscript` (`uv sync --locked`), `lint:gdscript`, formatting check/write variants, parser/typecheck, approved tests/exports, and first-party `.gd` duplicate coverage. Append public task dependencies without replacing other languages or creating recursion.
- Keep normal lint/format/parser/test/build/duplicate tasks non-mutating; only explicit fix tasks write source. Preserve first-party code coverage rather than broadening ignores to make checks pass.

## Executable addons

[GdUnit4](https://github.com/godot-gdunit-labs/gdUnit4), [GUT](https://github.com/bitwes/Gut), editor plugins, and native extensions execute code. Their downloads/enabling need a separately approved framework plan. Pin a compatible release/commit, verify authoritative checksums or recorded digests where available, reject traversal during extraction, and never execute downloaded addon code during inspection or installation. Enabling or running the framework is a separate approved step. Do not introduce a second addon manager.

## Helper usage

Run from the `init-project` directory:

```text
bun scripts/gdscript/init.ts --help
bun scripts/gdscript/init.ts --root /absolute/game --godot 4.7.2-stable --python 3.13.13 --uv 0.11.25 --source game
```

The default JSON plan includes final proposed contents. `--apply --confirm` writes approved changes; `--install` additionally changes mise trust, installs tools, and runs uv lock/sync, requiring explicit consent. The helper does not select or download a test framework.

## Language verification

Check the actual Godot version, compatible gdformat/gdlint, isolated headless parser/import behavior, configured tests/exports, aggregate checks, and `mise run validate`. Preserve Node-tooling pnpm audit and other configured ecosystem audits. Addons have no universal vulnerability audit: pinned versions, parsing, or tests do not establish vulnerability coverage, and missing framework/platform/SDK checks remain gaps.
