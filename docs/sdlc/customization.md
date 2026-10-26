# Customize lifecycle prompts

Use a project addition when a repository needs extra requirements in one lifecycle command. Use a complete override only when the command structure itself must change.

## Add project instructions

Create one plain Markdown file under `.neottia/templates/sdlc/`:

| Command  | File                 |
| -------- | -------------------- |
| Plan     | `plan.append.md`     |
| Build    | `build.append.md`    |
| Verify   | `verify.append.md`   |
| Release  | `release.append.md`  |
| Continue | `continue.append.md` |
| Refresh  | `refresh.append.md`  |

For example, `.neottia/templates/sdlc/verify.append.md` can contain:

```markdown
- Run the project UI checks at the supported viewport sizes.
- Attach screenshots for user-visible changes.
```

Neottia appends the file under `## Project instructions` in the matching generated command. It does not add the text to other commands.

Addition files are plain Markdown. Neottia does not evaluate Twig expressions in them. This text remains literal:

```markdown
Do not expand {{ instructions.issues }}.
```

Project additions do not remove, replace, or reorder canonical text. The generated section ends with a fixed statement that canonical approvals, stop conditions, provider instructions, role instructions, lifecycle transitions, and permission boundaries still apply.

Run `neottia apply --project .` after adding or changing a file. Restart the host when package configuration changed. Reloading the host is sufficient when only prompt files changed and the host supports prompt reloads.

Track project additions in Git. The loader rejects unknown filenames, linked files, invalid text, empty content, and content above the published fragment byte limit.

## Replace a complete command

A complete project override uses `.neottia/templates/sdlc/<command>.md.twig`. The accepted command names are `plan`, `build`, `verify`, `release`, `continue`, and `refresh`.

Complete overrides use the shared Twig layout and can change lifecycle policy. The compiler checks template structure and required capability and role fragments, but it cannot prove that replacement prose preserves the intended workflow. Review a complete override before installation.

Template precedence is:

1. packaged files;
2. explicit installed-package layers;
3. a global override;
4. a project override.

Global roots accept complete command and protocol overrides. Append-only instruction files are project-scoped.

The Twig context exposes:

- `command`, with the command ID, transitions, approvals, stop conditions, roles, and enforcement mode;
- `instructions`, with selected capability instruction packs;
- `roles`, with the ordered role instruction entries.

The shared layout has one block for each capability instruction slot. The compiler rejects duplicate instruction fragments, missing role fragments, dynamic template dependencies, recursive inheritance, unbounded loops, and nondeterministic functions.

## Replace the operating protocol

The operating protocol is a separate plain Markdown template at `.neottia/templates/sdlc/protocol.md`. It defines shared checkpoint, evidence, approval, and handback procedures.

Read [the operating protocol reference](/sdlc/protocol) before replacing it. A protocol replacement must preserve the documented checkpoint and permission invariants.
