---
layout: home

hero:
  name: Neottia
  text: A shared delivery workflow for AI coding harnesses
  tagline: Install one reviewable Plan → Build → Verify → Release lifecycle, then keep issues, design decisions, memory, and research in repository-owned formats.
  actions:
    - theme: brand
      text: Start in five minutes
      link: /get-started/
    - theme: alt
      text: See how it works
      link: /learn/

features:
  - title: One lifecycle, three hosts
    details: Compile the same six commands for Pi, OpenCode, and Claude Code without putting host-specific paths in the workflow.
  - title: Repository-owned evidence
    details: Track Issues, Design Docs, Memory, and Searchable records as reviewable files. Rebuild disposable indexes when needed.
  - title: Explicit authority boundaries
    details: Plans, installations, updates, and release actions stop for review. Neottia does not turn workflow text into permission.
---

## What do you want to do?

| Goal                                                          | Start here                                       |
| ------------------------------------------------------------- | ------------------------------------------------ |
| Add the lifecycle to an existing repository                   | [Install and run your first plan](/get-started/) |
| Understand the compiler, adapters, and storage model          | [Learn how Neottia fits together](/learn/)       |
| Use Memory, Issues, Design Docs, or Searchable                | [Choose a capability](/guides/)                  |
| Diagnose installation or platform problems                    | [Operate Neottia](/operate/)                     |
| Configure providers, roles, templates, or installation policy | [Configuration reference](/configuration)        |

## The shortest useful path

Run these commands from the target repository root:

```sh
pnpm add --global @neottia/cli
neottia init --harness pi
neottia apply
neottia doctor
```

Replace `pi` with `opencode` or `claude-code`. Then restart the host and run `/neottia-plan` for one small repository change. Claude Code users must also open `/mcp` and approve the project servers that Neottia added.

Neottia supports certified local filesystems and runtime tuples only. Check the [requirements](/get-started/requirements) before enabling filesystem-backed capabilities.
