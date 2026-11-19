# Project initialization

`init-project` is the only initializer skill. Its compact [`SKILL.md`](SKILL.md) owns routing, approval, and shared safeguards; plain reference files define each setup phase.

## Definitions and dependencies

- [Project foundation](references/project.md): mise, Node, pnpm, Tempel, Husky, and the public task contract.
- [TypeScript](references/typescript.md): explicitly reads `project.md` first.
- [Godot GDScript](references/gdscript.md): explicitly reads `project.md` first.

Read each applicable definition once. Foundation definitions do not authorize running foundation setup. Foundation and language changes keep separate approvals. Missing foundation state, references, or tools stop initialization.

There are no inter-skill instruction or code dependencies. Every helper, test, and reference is bundled here. Language helpers import the local [`scripts/lib.ts`](scripts/lib.ts); references are regular Markdown files, not symlinks or separate skills.

## Use

```text
/skill:init-project
```

Run the selected helper from this directory:

```text
bun scripts/init.ts --help
bun scripts/typescript/init.ts --help
bun scripts/gdscript/init.ts --help
```

Pass an absolute target root. The default is a non-mutating plan; application requires `--apply --confirm`. Add `--install` only with explicit approval for installation, lockfiles, and user-level mise trust changes. Bun runs the helpers but is not added to target toolchains; the shared control plane requires Node 24 or newer.

Manual installation needs just one asset:

```sh
npx -y skills@1.7.4 add https://github.com/dragoscirjan/ai/tree/main/.agents/skills/coding/init-project --skill init-project --agent pi --agent opencode --agent claude-code
```

Install the complete skill directory, including its helpers. Initialization is an approval-bound choice, not automatic setup. Claude Code uses the exact relative projection; reload the harness after installation.

## Migration and verification

Replace obsolete `init-typescript`/`init-gdscript` selections or declines with the appropriate `init-project` decision. Review target instruction changes and retain legacy files/projections until their removal is explicitly approved. No automatic remapping, downstream deletion, or lockfile hand-editing is added.

Language helpers now live under `scripts/<language>/init.ts` and return `skill: "init-project"` plus a `language` field. The foundation helper and shared library retain their existing paths and behavior.

Run the foundation and language tests with `bun test` using explicit `./.agents/...` paths. See [issue #59](https://github.com/dragoscirjan/ai/issues/59).

## Sources

[mise configuration](https://mise.jdx.dev/configuration.html), [mise tasks](https://mise.jdx.dev/tasks/), [pnpm manifests](https://pnpm.io/package_json), [Husky](https://typicode.github.io/husky/get-started.html), [Tempel toolkit](https://github.com/dragoscirjan/tempel-javascript), [Commitlint](https://commitlint.js.org/), [jscpd](https://jscpd.dev/), [skill scripts](https://agentskills.io/skill-creation/using-scripts), [Bun TOML](https://bun.com/docs/runtime/toml).
