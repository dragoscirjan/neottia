# Install generated assets

Neottia installs generated prompts, skills, extensions, agents, package declarations, and MCP settings through two packages:

| Package                 | Purpose                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| `@neottia/distribution` | Manifest, template, receipt, planning, transaction, recovery, and doctor APIs |
| `@neottia/cli`          | The installable `neottia` command                                             |

The compiler produces an asset manifest. A Pi or OpenCode adapter supplies symbolic destinations and semantic host configuration operations. The installer resolves those values against explicit project, home, XDG config, and XDG state roots.

## Plan before applying

Installation uses separate review and apply commands:

```sh
neottia plan --manifest manifest.json --output install.plan.json
neottia apply --plan install.plan.json
```

The plan includes every target file mutation, its expected current checksum or expected absence, the intended checksum, and the complete content. The plan also contains receipt changes and reload instructions. `apply` verifies the plan digest and every current checksum again.

Use the same flow for updates:

```sh
neottia plan \
  --action update \
  --manifest manifest.json \
  --output update.plan.json
neottia apply --plan update.plan.json
```

Update requires an existing valid receipt. Assets removed from the new manifest are removed or restored only when the old receipt proves ownership.

## Resolve conflicts

Neottia does not infer ownership from a filename, marker, or matching content.

Planning reports one of these conflicts:

- `unowned-existing` means the target exists but no receipt owns it.
- `modified-owned` means a receipt owns the target, but the current checksum differs from the receipt.

Approve each intended replacement by its exact conflict ID:

```sh
neottia plan \
  --manifest manifest.json \
  --approve conflict.0123456789abcdef \
  --output approved.plan.json
```

The CLI rejects unknown conflict IDs. It has no wildcard approval and no force option. Approval of displaced operator content stores its original state in the receipt so uninstall can restore it.

## Uninstall

Project receipts are under `<project>/.neottia/install/`. Global receipts are under `$XDG_STATE_HOME/neottia/install/`, with `~/.local/state` as the Linux default used by the CLI.

Generate and review an uninstall plan before applying it:

```sh
neottia uninstall \
  --receipt .neottia/install/default.receipt.json \
  --output uninstall.plan.json
neottia apply --plan uninstall.plan.json
```

Uninstall removes units that were absent before installation. It restores content that an approved installation displaced. Host configuration ownership applies to one package identity or MCP key, so unrelated settings remain in place.

Receipts can contain displaced content. Protect project receipts with the same access policy as local configuration and credentials. New receipt and journal files use mode `0600` where the filesystem supports it.

## Transactions and recovery

Apply performs these steps:

1. Acquire a lock for the installation receipt.
2. Verify every expected current file checksum.
3. Write a transaction journal with exact before-images.
4. Publish writes through temporary files in each destination directory.
5. Publish the receipt as part of the same transaction.
6. Mark the journal committed and remove it.

A normal failure restores completed changes in reverse order. If the process stops after journal creation, run:

```sh
neottia recover --receipt .neottia/install/default.receipt.json
```

An active journal rolls back. A committed journal only needs cleanup. Recovery stops if a path no longer matches either the recorded before-state or intended after-state. It keeps the journal so an operator can inspect the conflict.

## Template precedence

Template lookup uses four fixed tiers:

1. templates packaged with Neottia;
2. explicitly configured installed template packages;
3. global overrides;
4. project overrides.

A higher tier replaces one complete template file. The resolver records the selected and shadowed source, version, and checksum. Duplicate IDs within one tier fail. Neottia does not scan `node_modules`, so package manager layout and directory order cannot change the result.

The same requested IDs, source versions, integrity values, and contents produce the same manifest and asset checksums.

Each source is explicit. Point `loadTemplateLayer` at an absolute manifest path and assign its tier, stable source ID, and version. The source manifest maps stable template IDs to files and SHA-256 checksums:

```json
{
  "schemaVersion": 1,
  "templates": {
    "neottia.command.plan": {
      "file": "commands/plan.md",
      "checksum": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  }
}
```

Files must remain below the manifest directory. Symbolic links, checksum mismatches, duplicate IDs, and sources that exceed the configured byte limit fail before asset planning.

## Static third-party skills

Static third-party skills use the [`skills`](https://www.npmjs.com/package/skills) package. Neottia invokes its direct dependency without a shell and without downloading a package at runtime.

The command runs in a temporary project with temporary home and XDG directories. It copies requested skills to a universal staging directory. Neottia then:

- rejects symbolic links and special files;
- enforces file-count and byte limits;
- verifies the configured digest for the complete requested skill trees;
- keeps supporting files under `scripts/`, `references/`, and other skill directories;
- asks the selected adapter for the final skill target;
- converts staged files into normal manifest assets.

The `skills` package never writes the final Pi or OpenCode directories.

## Host configuration

Harness adapters return semantic operations instead of replacement settings files. The installer supports package array entries and named MCP object entries. It tracks ownership per entry.

JSONC edits preserve unrelated keys and comments. Planning fails when both configuration candidates exist, such as both `opencode.json` and `opencode.jsonc`. Remove the ambiguity before generating a plan.

## Configuration

The official configuration registry owns three strict sections:

```yaml
version: 1
harnesses:
  install:
    targets:
      - id: pi
        scope: project
      - id: opencode
        scope: global
assets:
  install:
    static_skills:
      - id: company-skills
        source: https://github.com/acme/agent-skills.git
        revision: 0123456789abcdef0123456789abcdef01234567
        integrity: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        skills: [review]
templates:
  install:
    packages:
      - id: team-templates
        path: node_modules/@acme/neottia-templates/neottia.templates.json
        version: 2.1.0
    global_overrides: []
    project_overrides: []
```

Template packages and skill sources must be explicit. The configuration does not install packages, clone credentials, or choose an SDLC provider.

## Doctor

Run non-mutating checks with:

```sh
neottia doctor --manifest manifest.json
```

Manifest prerequisites can check an executable, installed package, required path, or environment variable. Missing requirements return setup instructions. Receipt checks report drift and interrupted transactions. Doctor does not install CLIs, packages, MCP servers, databases, or credentials.

## Library example

```ts
import {
  applyInstallationPlan,
  authorizePlan,
  createInstallationPlan,
  inspectInstallation,
} from "@neottia/distribution";

const snapshot = await inspectInstallation(manifest, {
  project: process.cwd(),
  home: process.env.HOME!,
  xdgConfig: process.env.XDG_CONFIG_HOME!,
  xdgState: process.env.XDG_STATE_HOME!,
});
const proposed = createInstallationPlan(snapshot, "install");
const approved = authorizePlan(proposed, selectedConflictIds);
await applyInstallationPlan(approved);
```

Applications should display the complete plan before calling `applyInstallationPlan()`.
