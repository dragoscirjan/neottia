---
name: cleanup-workspaces
description: Audit and safely remove old Git worktrees or Jujutsu workspaces after their changes are integrated. Use only when the owner explicitly asks to clean merged, finished, or abandoned isolated workspaces.
disable-model-invocation: true
compatibility: Requires Git with worktree support or Jujutsu with workspace support.
metadata:
  author: dragoscirjan
  version: "1.0"
  opencode/slash: "true"
---

# Cleanup workspaces

Find isolated workspaces that are safe to remove. Show a cleanup plan. Remove only the targets that the owner confirms.

This skill is destructive. Loading or invoking the skill authorizes an audit only. It does not authorize removal.

## Read the workspace policy

Read the nearest applicable `AGENTS.md` and the repository's `isolated-workspace` skill before the audit. Require these values:

- version-control system: `git` or `jj`
- base revision
- workspace root
- branch or bookmark prefix

Do not guess a missing value. Ask the owner to configure it.

Use only the configured version-control system. Do not mix Git and Jujutsu procedures in a colocated repository.

Resolve `derive-from-memory-or-origin` with the repository-identity procedure in `isolated-workspace`. Resolve a relative workspace root from the repository root. Canonicalize every candidate path before comparing it with the workspace root.

## Start with an audit

Treat requests such as "clean old workspaces" or `/skill:cleanup-workspaces` as requests to inspect and plan.

If the owner names one or more workspaces, restrict the audit to those names. Do not add other candidates without asking.

Run the audit from a workspace that will survive cleanup. Never remove:

- the primary checkout
- the current process directory or any of its parents
- the workspace that contains the active agent session
- a locked workspace
- a workspace outside the configured workspace root
- a workspace whose branch or bookmark does not match the configured prefix
- a workspace that belongs to another repository, issue, or task
- a workspace with unresolved conflicts or an operation in progress
- a workspace with changes that are not covered by the integration evidence
- a workspace whose state, ownership, path, or integration status is uncertain

Do not fetch, pull, rebase, update bookmarks, or change the base revision during the audit. If the local base or remote-tracking data may be stale, report that limit and stop. Let the owner update repository state before a new audit.

An owner's statement that work was merged is a cleanup request, not sufficient merge evidence.

## Require integration evidence

Accept a candidate only when one of these checks proves that the exact candidate tip is integrated:

1. The candidate tip is an ancestor of the configured base revision in the local commit graph.
2. A trusted hosting service reports a merged change for the same repository and ref, and the service's recorded head commit equals the candidate tip.

For a squash or rebase merge, local ancestry can fail. Use hosting evidence only when it identifies the exact head commit. Do not infer integration from a closed change, a deleted remote ref, a similar commit message, or a clean directory.

Record the base revision and its resolved commit ID in the plan. Record the evidence for each candidate.

## Audit Git worktrees

Use this procedure only when the configured version-control system is `git`.

1. Read registered worktrees with machine-readable output:

   ```sh
   git worktree list --porcelain -z
   ```

2. Keep only linked worktrees whose canonical paths are inside the configured workspace root.
3. Skip bare, detached, locked, prunable, missing, or inaccessible entries.
4. Require the recorded branch to start with `refs/heads/<configured-prefix>/`.
5. Confirm that the worktree uses the same Git common directory as the repository.
6. Confirm that the candidate is not the primary checkout. In the primary checkout, the absolute Git directory equals the common Git directory. A linked worktree has its own Git directory below the common directory's `worktrees` area.
7. Inspect the candidate without changing it:

   ```sh
   git -C "$workspace_path" status --porcelain=v1 --untracked-files=all
   git -C "$workspace_path" symbolic-ref -q HEAD
   git -C "$workspace_path" rev-parse HEAD
   git rev-parse "$branch_name"
   ```

   Require empty status output. Require the symbolic ref to match the recorded branch. Require the worktree `HEAD`, branch tip, and audited tip to be the same commit.

8. Check for merge, rebase, cherry-pick, revert, or bisect state through the candidate's Git paths. Skip the candidate if any operation is active.
9. Preview ignored files that workspace removal may delete:

   ```sh
   git -C "$workspace_path" clean -ndX
   ```

   Include the preview in the plan. Do not run `git clean` without `-n`.

10. Prove local integration when possible:

    ```sh
    git merge-base --is-ancestor "$tip_commit" "$base_revision"
    ```

    Exit status `0` proves local ancestry. Any other status requires exact hosting evidence or disqualifies the candidate.

Do not use `--force`, `git branch -D`, `git clean -f`, or manual deletion for a registered Git worktree.

## Audit Jujutsu workspaces

Use this procedure only when the configured version-control system is `jj`.

1. Read registered workspaces from a workspace that will survive cleanup:

   ```sh
   jj workspace list
   ```

2. Resolve each candidate root:

   ```sh
   jj workspace root --name "$workspace_name"
   ```

3. Keep only workspaces whose canonical roots are inside the configured workspace root. Skip missing, stale, inaccessible, or unresolved roots.
4. Skip the current workspace and the repository's primary workspace.
5. Derive the expected bookmark as `<configured-prefix>/<workspace-name>`. If a different bookmark represents the change, require explicit project evidence for that mapping.
6. Snapshot and inspect the candidate:

   ```sh
   jj -R "$workspace_path" status
   jj -R "$workspace_path" diff --summary -r @
   ```

   Skip conflicts and concurrent-operation warnings. Record the candidate working-copy commit after `jj status` snapshots the files.

7. Accept one of these safe working-copy shapes:

   - The working-copy commit is the exact integrated tip.
   - The working-copy commit is empty and every parent is integrated.

   A non-empty working-copy commit that differs from the integrated tip is not safe to remove.

8. Use revsets to prove ancestry. The following query must select the exact candidate tip before local ancestry counts as evidence:

   ```sh
   jj log -r "$tip_revision & ::$base_revision" --count
   ```

   Require a count of `1`. Require the base and candidate expressions to resolve without ambiguity or conflict.

9. If the expected bookmark exists, resolve its target and require it to match the audited tip or the integrated parent of an empty working-copy commit. If no bookmark exists, the working-copy revision itself must provide the integration evidence.
10. Do not use `jj abandon`. An integrated commit does not need to be abandoned during workspace cleanup.

`jj workspace forget` does not delete files from disk. The cleanup plan must state that Jujutsu detaches the workspace first and removes the confirmed directory separately.

Use `jj bookmark forget`, not `jj bookmark delete`, when removing an eligible local bookmark. `bookmark delete` can propagate deletion to a remote on the next push.

## Present the cleanup plan

Show one row for every candidate:

- workspace name
- canonical path
- branch or bookmark
- exact tip commit
- configured base and resolved commit
- clean-state result
- integration evidence
- ignored or untracked files that directory removal will delete
- exact removal commands

Show skipped workspaces separately with the reason for each skip.

Do not present an uncertain workspace as eligible.

Ask the owner to confirm the complete eligible set. A valid confirmation must occur after the plan is shown. If the set or any audited state changes, discard the confirmation and audit again.

## Remove confirmed Git worktrees

Immediately before each removal, repeat the path, scope, branch, clean-state, operation-state, tip, and integration checks. Stop if any result changed.

Run these commands without force:

```sh
git worktree remove "$workspace_path"
git branch -d "$branch_name"
```

If `git worktree remove` fails, stop for that candidate and preserve the branch. If `git branch -d` fails, keep the branch and report the failure. Never retry with `--force` or `-D`.

Verify that the path is absent from `git worktree list --porcelain` and that no confirmed user files remain unexpectedly.

## Remove confirmed Jujutsu workspaces

Immediately before each removal, repeat the path, scope, current-workspace, conflict, working-copy, tip, bookmark, and integration checks. Stop if any result changed.

From a surviving workspace, run:

```sh
jj workspace forget "$workspace_name"
```

If an eligible local bookmark remains, remove only the local bookmark relationship:

```sh
jj bookmark forget "$bookmark_name"
```

Verify that the workspace name is absent from `jj workspace list`. Then recheck that the canonical directory is the exact confirmed path inside the configured workspace root. Remove that directory without a force flag:

```sh
rm -r -- "$workspace_path"
```

If any Jujutsu command or filesystem removal fails, stop and report the partial result. Do not use `rm -rf`, `jj abandon`, or `jj bookmark delete` as a retry.

## Report the result

List:

- removed workspaces
- deleted Git branches or forgotten Jujutsu bookmarks
- retained branches, bookmarks, directories, or metadata
- skipped workspaces and reasons
- failed commands and the remaining safe recovery step

Do not claim cleanup succeeded until the VCS registry and filesystem checks pass.
