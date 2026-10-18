# Validation

Read this document before validating, committing, pushing, or publishing a repository change. Run the checks that match the changed files and behavior.

Record each check that ran. If a required check cannot run, state why. Do not claim that an unexecuted check passed.

## Every change

- Run `git diff --check`.
- Review `git status` and the complete diff.
- Confirm that only files required by the issue or task changed.
- Check that examples describe behavior that exists.
- Remove generated changes created by validation only when they are known artifacts and contain no user work.
- Run `mise run validate` before pushing unless the task changes only files that cannot affect that task. Record any narrower validation and the reason the full task did not run.

## Code changes

- Load the generic `coding` skill and every matching language or extension skill.
- Build every affected package through mise.
- Run focused tests while developing and the applicable workspace validation before pushing.
- Confirm that integration tests use temporary directories and leave the repository and worktree unchanged.
- Check public API, configuration, persisted-data, adapter, and package compatibility when the change touches those boundaries.
- Add a Changeset for each user-visible published-package change.
- Report the code indexer used, its repository scope, and any reliability limitation encountered.

## Skill changes

When a change adds or modifies a skill:

- Verify that every `SKILL.md` has valid `name` and `description` frontmatter.
- Verify that each skill directory name matches its declared `name`.
- Verify that Pi and OpenCode discover the skill from `.agents/skills/`.
- Check relative references, supporting files, and command examples.
- Confirm that harness-specific behavior is explicit and does not appear as portable Agent Skills behavior.
- Confirm that copied assets contain no credentials, personal paths, or repository-specific assumptions that conflict with Neottia.

## Coding-skill changes

When a change adds or modifies `coding` or a `coding-*` skill:

- Confirm that all coding skills are sibling directories directly under `.agents/skills/`.
- Confirm that language skills require `coding` and extension skills require both `coding` and their language skill.
- Confirm that dependencies resolve through advertised skill names and paths without a harness-specific Skill tool.
- Test generic-to-language-to-extension load order, missing-dependency stops, and dependency-cycle rejection when those relationships exist.
- Confirm that wrappers contain only extension-specific differences.
- Confirm that project configuration takes precedence over fallback tools.
- Confirm that no skill installs, replaces, or reconfigures tools without owner approval.
- Confirm that numeric thresholds come only from project configuration.
- Check source links and maintenance notes for external guidance.
- Verify flat discovery in Pi and OpenCode.

## Workspace-skill changes

When a change modifies `isolated-workspace` or `cleanup-workspaces`:

- Exercise the configured Git procedure in a disposable repository.
- Exercise the Jujutsu procedure in a disposable repository when the changed behavior claims Jujutsu support.
- Test relevant safety stops, not only the successful path.
- Confirm that `AGENTS.md` supplies all required workspace configuration.
- Confirm that workspace commands remain in the skills and are not duplicated in project policy files.
- Confirm that repository identity lookup remains memory or context first, falls back to Git only on a miss, and stores only safe derived identity data.

## Instruction changes

When a change modifies `AGENTS.md`, `CONTRIBUTING.md`, `VALIDATION.md`, or instruction routing metadata:

- Confirm that `AGENTS.md` contains startup routing, project configuration, always-on security rules, and owner authority rather than detailed procedures.
- Confirm that every deferred document or mandatory skill has a clear trigger.
- Confirm that planning or code inspection loads `CONTRIBUTING.md`.
- Confirm that mutation requires `isolated-workspace`.
- Confirm that validation, commits, pushes, and publication require `VALIDATION.md`.
- Confirm that cleanup requires `cleanup-workspaces`.
- Confirm that instruction drift requires `instruction-maintenance` before an adaptation proposal.
- Confirm that instruction mutation requires owner approval of the exact proposal.
- Check for missing targets, stale paths, duplicated policy, conflicting rules, ambiguous triggers, and dependency cycles.
- Confirm that security boundaries, validation requirements, and owner authority did not weaken without separate explicit approval.

## Markdown and documentation changes

- Load `unslop` for user documentation.
- Review heading order and section structure.
- Check local links and relevant external links.
- Review code fences, commands, paths, and examples manually.
- Use sentence-case headings and direct, concrete language.
- Build the VitePress site when user documentation or its configuration changes.
- Confirm that the root README still summarizes the user documentation when its scope changes.

## Release changes

- Confirm that versions changed through Changesets, not direct package manifest edits.
- Confirm that `packages/release/release-manifest.json` was generated by the approved release task.
- Verify package contents and public entry points for affected published modules.
- Do not publish, tag, create a release, merge, or change release environments without explicit owner instruction.

## Publication report

Before pushing or opening a pull request, summarize:

- changed files;
- checks that passed;
- checks that failed;
- checks that did not run and why;
- code-indexing limitations;
- remaining risks or follow-up work.
