# Documentation

Assess documentation impact during implementation. Update affected documentation in the same change, or give a concrete reason no update is needed.

## Required guidance

- For implementation and documentation work, read and follow `.agents/skills/document-project/SKILL.md`.
- Before drafting or revising documentation, also read and follow `.agents/skills/asd-ste100-technical/SKILL.md` and `.agents/skills/unslop/SKILL.md`.
- If required guidance or prerequisites are missing, stop the affected phase and report the gap. Do not skip, recreate, or install them without approval.

## Audience and reader tasks

Neottia documentation serves developers and operators who use its shared SDLC through Pi or OpenCode. Explain how to install supported modules, configure providers and harnesses, use Issues, Design Docs, Memory, and Searchable, and diagnose supported failure modes. Assume familiarity with a terminal and the selected harness, not Neottia's internal implementation.

Keep contributor procedures in `CONTRIBUTING.md` and validation requirements in `VALIDATION.md`. Do not put contributor procedures in the user documentation site.

## Sources and ownership

- `docs/` contains the user documentation sources.
- `docs/.vitepress/config.ts` owns site configuration and navigation.
- `docs/public/` contains shipped static assets. Regenerate diagram HTML from its source inputs rather than editing generated HTML.
- `docs/diagrams/sources/` contains editable diagram inputs.
- `docs/.vitepress/dist/` and `docs/.vitepress/cache/` are generated local output, not authored documentation.
- `docs/reference/dependencies.md` is generated from root and workspace package manifests.
- The root `README.md` summarizes user documentation. It may include a development section with project structure and mise commands.
- Package README files explain user-facing purpose, installation, configuration, and usage.

The change author updates affected documentation, examples, reference entries, and navigation in the same change.

## Engine selection

Neottia publishes user documentation from `docs/` with VitePress. Preserve this engine and `docs/.vitepress/config.ts`; no new site or migration is part of skill synchronization.

- Keep an existing approved MkDocs or VitePress site, including its configuration, theme, plugins, and commands.
- Preserve any other existing documentation system unless an explicit migration is approved.
- If MkDocs and VitePress both exist, or the canonical source is unclear, ask the owner before choosing a source, creating a competing site, or changing engine configuration.
- If no site is approved, maintain existing Markdown. When a site is needed, propose VitePress by default. The owner may choose MkDocs. Obtain baseline approval before setup.
- For received built documentation, generate in the owning repository. Leave generated files unedited and do not initialize a source site here.
- Choose from approved configuration or an owner decision, never solely from programming language.
- Site setup, dependencies, theme changes, migrations, and deployment require their applicable approval.

## Writing and maintenance

- Document supported behavior. Label planned and deferred work.
- Explain project-specific prerequisites, actions, results, and limits. Assume the agreed audience's standard skills.
- Update affected guides, examples, reference pages, and navigation with user-visible changes.
- Refactor unclear affected material instead of appending repetition. Keep unrelated cleanup and site rewrites separately approved.
- Document user behavior, configuration, operations, and limitations thoroughly enough that users do not need to inspect source code.
- Summarize user documentation in the root `README.md`.
- Load `asd-ste100-technical` while drafting documentation, then load `unslop` for the final writing pass.
- Use sentence-case headings, direct language, tested commands, and links to canonical reference pages.

## Canonical commands

Run commands from the active isolated repository root. Use the Node.js 22 and pnpm 10.28.2 toolchain configured in `mise.toml` and the dependencies declared in `package.json` and `pnpm-lock.yaml`. Installation or trust changes require their own approval; a missing prerequisite blocks its task.

- `mise run docs:serve` serves the VitePress site locally.
- `mise run docs` builds the VitePress site.
- `mise run docs:preview` previews the built site.
- `mise run docs:check` checks documentation catalogs, links, examples, schemas, tool references, and the generated dependency reference.
- `mise run docs:dependencies:generate` regenerates the dependency reference.

Keep the approved toolchain. Do not replace the package manager, Python environment, theme, or plugins merely to write documentation. Deployment is not local validation.

### Generate the dependency reference

After a root or workspace `package.json` changes, run:

```bash
mise run docs:dependencies:generate
mise run docs:check
```

Commit `docs/reference/dependencies.md` with the manifest change. The documentation check fails if the committed reference does not match the current manifests.

### Regenerate the diagrams

Create clean Archify and Neottia evidence checkouts outside the working tree:

```bash
git clone https://github.com/tt-a1i/archify.git ../archify
git -C ../archify checkout 208acba8d412335185b2056fedf54b3405df43fb
git worktree add ../neottia-diagram-evidence \
  d30ecaab86cf2d02a254736221221252c445fdfc
```

Run these commands from the current Neottia repository root:

```bash
export ARCHIFY_UPDATE_CHECK_DISABLED=1

node ../archify/archify/bin/archify.mjs finalize architecture \
  docs/diagrams/sources/neottia-system.architecture.json \
  docs/public/diagrams/neottia-system.html \
  --repo-root ../neottia-diagram-evidence \
  --quality showcase

node ../archify/archify/bin/archify.mjs finalize lifecycle \
  docs/diagrams/sources/neottia-lifecycle.lifecycle.json \
  docs/public/diagrams/neottia-lifecycle.html \
  --repo-root ../neottia-diagram-evidence \
  --quality showcase

node ../archify/archify/bin/archify.mjs finalize dataflow \
  docs/diagrams/sources/neottia-runtime.dataflow.json \
  docs/public/diagrams/neottia-runtime.html \
  --repo-root ../neottia-diagram-evidence \
  --quality showcase
```

These commands retain the existing, pinned diagram recipe. The installed `archify` skill has separate catalog provenance; installing it does not authorize changing this recipe or regenerating the diagrams with a different version.

Run all Archify gates, then review the generated routes visually. The system and runtime diagrams can contain valid routed detours that reduce readability.

Archify writes local delivery, finalize, summary, and browser-check JSON receipts during validation. Remove these receipts after validation. They contain machine-local absolute paths and must not be committed.

## Completion

Run documentation checks from `VALIDATION.md`. Report builds, executed examples, agent walkthroughs, and actual user testing separately. Rendering does not prove task usability.

Required documentation is part of completion. If required documentation or checks are blocked, report the gap and obtain an explicit owner decision before calling the work complete.
