# Cleanup workspaces

`cleanup-workspaces` is a destructive companion to [`isolated-workspace`](../isolated-workspace/SKILL.md). It audits old isolated workspaces, proves that their changes are integrated, shows a removal plan, and waits for confirmation before cleanup.

The skill supports Git worktrees and Jujutsu workspaces.

## Origin

The `isolated-workspace` skill protects active work by creating each change in a dedicated workspace. Its cleanup section intentionally prevents deletion without an explicit request, a clean status, and proof that work is integrated or abandoned.

[Issue 6](https://github.com/dragoscirjan/ai/issues/6) adds the missing operational workflow. The new skill explains how an agent can find eligible workspaces, verify them, ask for confirmation, and remove them safely.

Cleanup remains separate from workspace creation because cleanup is destructive. This separation gives cleanup an explicit command and keeps `isolated-workspace` focused on protecting work before mutation.

## Safety model

Invoking the skill authorizes an audit. It does not authorize deletion.

The workflow has three phases:

1. Audit registered workspaces and collect evidence.
2. Show eligible and skipped workspaces with exact commands.
3. Ask for confirmation, repeat the safety checks, and remove only the confirmed targets.

The skill does not rely on a branch name, directory age, closed pull request, or user statement as proof of integration. It requires local ancestry or a trusted merged-change record tied to the exact candidate tip.

The skill never force-removes workspaces or refs. It protects:

- the primary checkout
- the active workspace and process directory
- dirty, conflicted, locked, stale, missing, or ambiguous workspaces
- workspaces outside the configured root
- branches and bookmarks outside the configured prefix
- changes that lack exact integration evidence

A changed audit invalidates the owner's confirmation. The agent must audit again.

## Git behavior

The Git procedure uses the registered worktree list, canonical paths, repository identity, branch refs, clean status, operation state, and exact commit IDs.

Local integration is proven with `git merge-base --is-ancestor`. Git removes an eligible workspace with `git worktree remove` and attempts local branch deletion with `git branch -d`.

The skill forbids `git worktree remove --force`, `git branch -D`, `git clean -f`, and manual deletion of a registered worktree.

See the official [`git-worktree` documentation](https://git-scm.com/docs/git-worktree) for command behavior.

## Jujutsu behavior

The Jujutsu procedure uses registered workspace names and roots, working-copy revisions, expected bookmarks, conflicts, diffs, and revset ancestry.

An eligible working copy must be the exact integrated revision or an empty child whose parents are integrated. Jujutsu first detaches the workspace with `jj workspace forget`.

Jujutsu does not delete the workspace files. After the workspace is forgotten and the path is revalidated, the workflow removes the confirmed directory without a force flag.

The skill uses `jj bookmark forget` for an eligible local bookmark. It forbids `jj bookmark delete` because that deletion can propagate to a remote. It also forbids `jj abandon` during workspace cleanup.

See the official [Jujutsu workspace documentation](https://docs.jj-vcs.dev/latest/working-copy/#workspaces) and [`jj workspace forget` reference](https://docs.jj-vcs.dev/latest/cli-reference/#jj-workspace-forget).

## Invocation

Run an audit for every configured workspace:

```text
/skill:cleanup-workspaces Audit old merged workspaces.
```

Restrict the audit to a named workspace:

```text
/skill:cleanup-workspaces Audit issue-42 for cleanup.
```

Neither command authorizes removal. The agent must show the plan and ask for confirmation.

## Files

- [`SKILL.md`](SKILL.md) contains the agent workflow and safety rules.
- `README.md` explains the design and its relationship to `isolated-workspace`.

Keep the directory name and the `name` field in `SKILL.md` set to `cleanup-workspaces` for portable Agent Skills discovery.
