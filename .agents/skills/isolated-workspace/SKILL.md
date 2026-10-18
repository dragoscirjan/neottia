---
name: isolated-workspace
description: Create or reuse one isolated change workspace before mutating a version-controlled repository. Use for any architecture, design, implementation, coding, documentation, configuration, or other task that changes files. Supports Git worktrees and Jujutsu workspaces and prevents work in the primary checkout.
compatibility: Requires Git with worktree support or Jujutsu with workspace support.
metadata:
  author: dragoscirjan
  version: "1.1"
  opencode/slash: "true"
---

# Isolated workspace

Establish a dedicated workspace before the first repository mutation. Do not edit, generate, move, or delete repository files until this gate passes.

## Read project configuration

Read the nearest applicable `AGENTS.md` and require these values from its **Isolated workspace** section:

- version-control system: `git` or `jj`
- base revision
- workspace root: an explicit path or `derive-from-memory-or-origin`
- branch or bookmark prefix

Do not guess missing values. Stop and ask the owner to configure them.

Use only the configured version-control system. A colocated repository may contain both `.git` and `.jj`; do not switch tools or mix their workspace workflows.

## Protect existing work

- Never mutate the primary checkout.
- Never stash, reset, clean, move, or delete pre-existing user changes.
- Keep one active writer per workspace.
- Do not create a nested workspace when the current directory is already a dedicated workspace for the same tracked change.
- Reuse an existing workspace only after verifying that it belongs to the same change and has no unrelated modifications.
- If a branch, bookmark, workspace name, or destination path collides with unrelated work, stop and ask the owner for a different change identifier.

## Choose the change identity

Derive a short filesystem-safe `change_id` from the tracked issue or task. Use lowercase letters, numbers, and hyphens.

Assign the configured values. When the workspace root is `derive-from-memory-or-origin`, resolve the repository name in this order:

1. Query any available project-scoped memory or context MCP for the current repository identity.
2. Accept a result only when it is unambiguous and scoped to the current project. Ignore generic, unrelated, or stale entries.
3. On a miss, run `git config get remote.origin.url` once. If command execution requires approval or is blocked, ask the owner for approval; do not retry repeatedly or guess.
4. Derive the repository name from the remote URL.
5. Store the derived repository name and its `git-config` provenance in the available project-scoped memory or context MCP so later runs can avoid the Git command.

Store only safe identity data. Never persist credentials, token-bearing URLs, embedded user information, or personal filesystem paths. Store a sanitized `host/owner/repository` identity only when it contains no secrets. If no memory or context MCP is available, continue without creating a repository cache file.

Use the Git fallback only when memory/context did not resolve `repository_name`:

```sh
remote_url="$(git config get remote.origin.url)" || {
  echo "remote.origin.url is required to derive the workspace root" >&2
  exit 1
}
repository_name="${remote_url##*/}"
repository_name="${repository_name%.git}"
if [ -z "$repository_name" ]; then
  echo "could not derive the repository name from remote.origin.url" >&2
  exit 1
fi
```

After `repository_name` is resolved from either source, construct the workspace values:

```sh
base_revision="value from AGENTS.md"
workspace_root_setting="value from AGENTS.md"
branch_prefix="value from AGENTS.md"

if [ "$workspace_root_setting" = "derive-from-memory-or-origin" ]; then
  workspace_root="../${repository_name}--workspaces"
else
  workspace_root="$workspace_root_setting"
fi

branch_name="$branch_prefix/$change_id"
workspace_path="$workspace_root/$change_id"
```

For a pure Jujutsu repository without a stored identity or Git configuration, require an explicit workspace root instead of `derive-from-memory-or-origin`.

Resolve a relative workspace root from the repository root. Confirm that the resulting workspace path is outside the primary checkout, then create the configured parent directory if needed:

```sh
mkdir -p "$workspace_root"
```

Do not create the directory until its resolved location has passed the outside-checkout check.

## Reuse a compliant workspace

Before creating anything, inspect registered workspaces and repository status.

A workspace is reusable only when all are true:

1. It is registered with the configured version-control system.
2. Its path equals the configured workspace path.
3. It belongs to the intended branch, bookmark, issue, or change.
4. Existing modifications belong to the current task.

When these conditions hold, continue there. Otherwise, do not repurpose it.

## Create a Git worktree

Use this procedure only when the configured version-control system is `git`.

From the repository root, inspect state without changing it:

```sh
git status --short --branch
git worktree list --porcelain
```

For a new branch and workspace:

```sh
git worktree add "$workspace_path" -b "$branch_name" "$base_revision"
git -C "$workspace_path" status --short --branch
```

If the branch already exists and is not attached elsewhere, omit `-b` and attach it deliberately:

```sh
git worktree add "$workspace_path" "$branch_name"
git -C "$workspace_path" status --short --branch
```

Do not run either creation command when the destination exists or the branch is attached to another worktree.

## Create a Jujutsu workspace

Use this procedure only when the configured version-control system is `jj`.

From the repository root, inspect state without changing it:

```sh
jj status
jj workspace list
```

Create a new workspace and working-copy change:

```sh
jj workspace add --name "$change_id" -r "$base_revision" "$workspace_path"
(
  cd "$workspace_path"
  jj describe -m "$change_id"
  jj status
)
```

Do not create a Git branch for a Jujutsu workspace. When publication requires a named bookmark, create it from the completed change:

```sh
(
  cd "$workspace_path"
  jj bookmark create "$branch_name" -r @
)
```

Do not overwrite an existing bookmark.

## Verify the gate

Before editing files, verify and report:

- selected version-control system
- absolute workspace path
- base revision
- branch or bookmark name
- status of the dedicated workspace

Perform every subsequent read, write, command, validation, commit, and publication step from that workspace. When tools do not preserve `cd`, pass the workspace explicitly through an absolute path or command working directory.

## Cleanup

Do not remove a workspace, branch, bookmark, or working-copy change unless the change is integrated or abandoned and the owner explicitly requests cleanup. Verify a clean status before cleanup and preserve any unmerged work.
