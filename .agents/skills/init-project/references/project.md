# Project foundation initialization rules

## Tool and dependency ownership

- Target Node 24 or newer. Older versions require a supported-version decision, not a lowered baseline. Select maintained compatible Node/pnpm versions, not floating `latest`.
- Mise owns standalone executable tools and `mise.lock`. `package.json`, pnpm, and `pnpm-lock.yaml` own Node dependencies. Do not put Husky, jscpd, Commitlint, ESLint, Prettier, or Tempel packages in mise.
- Tooling-only manifests are private. Changing an existing package's identity, publication, workspaces, exports, or release metadata requires explicit approval.
- Baseline manifest tools: Husky, jscpd, `@commitlint/cli` + `@tempel/commitlint`, ESLint + `@tempel/eslint`, and Prettier + `@tempel/prettier`. Reuse compatible project choices and the helper's tested pins.
- Use documented [Tempel APIs](https://github.com/dragoscirjan/tempel-javascript). `@tempel/tsconfig` is unmaintained.

## Public tasks and hooks

- Keep leaf commands in the owning manifest and let mise orchestrate namespaced implementations without recursion. Language setup appends task dependencies instead of replacing real checks.
- Checking tasks (`lint`, `format`, `code-duplicate`, `audit`, `typecheck`, `test`) must not rewrite source. `build` produces approved output artifacts. `quality` runs applicable gates; `validate` aliases it.
- Explicit `lint:fix` and `format:fix` tasks may write source. `deps:sync` installs pinned tools and locked dependencies. Reconcile failing placeholders explicitly; empty implementations are not successful checks.
- Proposed Husky policy: fast formatting/lint checks at pre-commit, Commitlint with the quoted message-file argument at commit-msg, and `mise run validate` at pre-push. Preserve existing hook managers and custom hooks.

## Foundation helper

The [helper](../scripts/init.ts) plans or applies this shared control plane. Run from the `init-project` directory:

```text
bun scripts/init.ts --help
bun scripts/init.ts --root /absolute/project --node 24 --pnpm 10.33.0
```

The JSON plan includes final proposed contents and marks redacted sensitive values. `--apply --confirm` writes approved files. `--install` additionally changes mise trust, installs tools, and updates locks, so those effects need explicit consent. Exact pinned packages are tested together; differing versions or incompatible existing values require reconciliation rather than bypassing conflict stops.
