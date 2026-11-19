---
name: init-project
description: "Initialize or adopt project foundations, TypeScript tooling, or Godot GDScript tooling only when explicitly requested."
compatibility: Requires Git, mise, and Bun with Bun.TOML.parse. Initialized targets require an approved Node 24-or-newer/pnpm control plane; GDScript also needs an explicitly selected compatible Godot toolchain. Installation and lockfile updates require approval.
metadata:
  author: dragoscirjan
  version: "1.0"
  opencode/slash: "true"
---

# Project initialization

Initialize only the explicitly requested phase. Loading instructions grants no setup authority. Read applicable project instructions and contribution policy, and satisfy approval and workspace gates before mutation. Stop on missing mandatory instructions or tools. Bun runs helpers only; it is not added to target toolchains.

## 1. Select one phase

| Requested setup | Read the applicable definition | Helper from this directory |
|---|---|---|
| Shared foundation | [Project foundation](references/project.md) | `scripts/init.ts` |
| TypeScript | [TypeScript rules](references/typescript.md) | `scripts/typescript/init.ts` |
| Godot GDScript | [GDScript rules](references/gdscript.md) | `scripts/gdscript/init.ts` |

Read only applicable definitions, their linked prerequisites first, and each document once. Missing references, cycles, unsupported languages, or unsupported project shapes stop setup for a new approved plan.

Foundation approval does not cover language setup. Language helpers require an approved existing foundation; if missing, stop for separately approved foundation setup rather than applying it automatically. Preserve other languages in mixed projects. Continue when the selected phase and its prerequisites are established.

## 2. Inspect and approve the complete plan

Inspect Git state, manifests/locks, mise tasks, hooks, validation, CI, runtimes, and platform constraints. Preserve equivalent tools, package managers, versions, hooks, publishable-package contracts, and unrelated settings.

Run the selected helper's `--help` from this directory and pass an absolute target root. Inspect the default non-mutating JSON plan and every proposed file.

Show final proposed contents, versions and sources, dependencies/overrides, scripts/tasks, hooks, conflicts, install commands, and lockfile changes. Redact sensitive existing values without hiding proposed edits. Obtain explicit approval for this phase; language approval follows foundation approval separately. Upgrades, automatic fixes, and executable addons are separate choices.

## 3. Apply the approved phase

Repeat selected arguments with `--apply --confirm`. Add `--install` only when installation, lockfile changes, and user-level mise trust-store changes are approved. Treat stdout as result data and stderr as diagnostics. Conflicts and unsupported shapes require a revised plan, not forced templates.

Use the owning package manager for manifest/lock changes instead of hand-editing locks. Honor configured tools, approved ignore paths, and project-defined thresholds. Mark unconfigured quality categories as gaps rather than passed.

Use bundled helpers for supported contracts. An approved replacement must remain plan-first, confirmation-gated, idempotent, root-confined, argument-array based, conflict-detecting, and failure-propagating. Preserve unrelated fields, avoid broad upgrades, and keep credentials unread, unlogged, and unpersisted.

## 4. Verify and report

After approved application, synchronize dependencies and run applicable language/aggregate checks. Inspect generated configuration, hook executability, outputs, lockfiles, and the full diff.

Report each gate as passed, failed, not run, or unsupported. Finish only when the selected phase is verified and every missing implementation or unchecked target is identified as a gap.
