---
aside: false
---

<script setup>
import { withBase } from 'vitepress'

const diagram = withBase('/diagrams/neottia-lifecycle.html')
</script>

# Lifecycle and authority boundaries

Neottia installs seven public commands. Four advance delivery work. Two help recover context without silently advancing it. Adopt reorganizes existing project documents through a separate approval and pull-request workflow.

<div class="diagram-links">
  <a :href="diagram" target="_blank" rel="noreferrer">Open the interactive lifecycle in a new tab</a>
</div>

<div class="diagram-frame editorial">
  <iframe :src="diagram" title="Interactive Neottia lifecycle and authority diagram" loading="lazy"></iframe>
</div>

## Delivery commands

| Command            | Owns                                                                         | Required stop                                             |
| ------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `/neottia-plan`    | Requirements, repository evidence, owning Epic, child work, and design scope | Stop for current scope or design approval                 |
| `/neottia-build`   | Only the approved implementation scope                                       | Stop with implementation evidence for Verify              |
| `/neottia-verify`  | Requirement coverage, checks, user-visible behavior, and verdict             | Return defects to Build or present a current pass verdict |
| `/neottia-release` | Release metadata and one explicitly selected action                          | Stop before any action that lacks fresh authorization     |

## Recovery commands

- `/neottia-continue` reads durable records and recommends exactly one next public command. It does not invoke that command.
- `/neottia-refresh` reloads configuration, provider records, repository state, and source-control state. It reports drift without changing phase.

## Project adoption

Use `/neottia-adopt` when an existing repository has legacy documents, instruction files, issue records, or design records that need to move into the configured Neottia model.

Adopt reads repository authority first and performs read-only discovery. It does not execute project code, hooks, task runners, installers, builds, tests, or dependency commands. It reports an exact document-operation plan and stops for approval before mutation. Every irreversible deletion needs separate approval.

After approval, Adopt verifies a dedicated non-default branch or isolated workspace, a usable Git remote, credentials, and a pull-request provider before document mutation. It never changes the default branch. It applies only approved document and Neottia-facing configuration operations, preserves originals until provider imports are verified, and never changes application source, dependencies, build systems, CI, or project-specific policy. It bypasses repository hooks for commit and push and never runs target-project validation.

Push and draft pull-request creation each need fresh action-specific approval. Adopt reports the draft pull-request URL and never merges, closes, or auto-approves it. Later runs report only remaining drift.

## Approval rules

Approval is narrow and current:

- Plan approval covers the recorded implementation scope.
- It does not authorize merge, publication, deployment, remote closure, or destructive cleanup.
- Release can prepare one action, but the action still needs explicit owner authorization.
- A confirmed defect becomes one canonical Bug and returns through Build.
- A stop records the exact revision, commits, checks, status, and recommended next command in an append-only checkpoint.

These rules remain the same in Pi, OpenCode, and Claude Code. Adapters change host syntax and paths, not lifecycle authority.

Read the [operating protocol reference](/sdlc/protocol) for the full checkpoint and ownership contract. See [diagram sources and attribution](/reference/diagrams) for evidence and license details.

<style scoped>
.diagram-links {
  margin: 1rem 0;
}
.diagram-frame {
  width: 100%;
  height: 720px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: #19140f;
}
.diagram-frame iframe {
  width: 100%;
  height: 100%;
  border: 0;
}
@media (min-width: 960px) {
  .diagram-frame {
    width: min(1200px, calc(100vw - var(--vp-sidebar-width) - 96px));
  }
}
@media (max-width: 640px) {
  .diagram-frame {
    height: 620px;
  }
}
</style>
