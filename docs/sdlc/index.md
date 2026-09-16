# Compile the canonical SDLC

`@neottia/sdlc` compiles six lifecycle commands into Pi or OpenCode prompt assets. The compiler chooses provider instructions before installation. Generated commands do not route between providers at runtime.

## Commands

| Command  | Required behavior                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Plan     | Read tracked work and repository evidence, define bounded scope, and stop for plan or design approval.                                  |
| Build    | Require approved plan evidence, implement only that scope, and stop on ownership conflicts or unexpected changes.                       |
| Verify   | Compare the change with requirements, run declared checks, and record failures before returning to Build.                               |
| Release  | Require approved scope and passing verification, prepare release evidence, and request explicit authorization for irreversible actions. |
| Continue | Inspect durable evidence, recommend one next public command, and stop without running it.                                               |
| Refresh  | Reload authoritative state, report drift, and avoid silent lifecycle transitions.                                                       |

Release instructions never authorize an autonomous merge, publication, or deployment. Every command states that workflow text does not grant host permissions.

## Inputs and outputs

Compilation depends only on explicit values:

- one immutable configuration snapshot;
- packaged, installed-package, global, and project template layers;
- checksummed provider instruction packs;
- optional checksummed role instructions;
- runtime package IDs with exact versions;
- one harness adapter and installation scope.

`createSdlcCompilerInput()` resolves template precedence and selects one instruction pack for each configured capability. It records configuration, template, instruction, role, and package provenance in a checksummed input manifest. `compileSdlc()` projects the six prompts and explicit package configuration through the adapter. The returned output manifest contains semantic command records and a checksummed distribution `AssetManifest`.

The compiler does not read files, invoke Git, contact providers, install packages, or change host configuration.

## Basic use

```ts
import { resolveHostConfigSnapshot } from "@neottia/config-registry";
import { piHarnessAdapter } from "@neottia/pi-adapter";
import { compileSdlc, createSdlcCompilerInput } from "@neottia/sdlc";

const snapshot = resolveHostConfigSnapshot({
  cwd: process.cwd(),
  interactive: false,
});

const input = createSdlcCompilerInput(snapshot, {
  compilerVersion: "0.1.0",
  harnessId: "pi",
  scope: "project",
  runtimePackages: [
    { logicalId: "issues", version: "0.1.0" },
    { logicalId: "design-docs", version: "0.1.0" },
  ],
});

export const output = compileSdlc(input, piHarnessAdapter);
```

Compile once per harness and scope. Use the same snapshot, template layers, instruction packs, role instructions, and runtime package list when Pi and OpenCode must preserve equivalent semantics. Their frontmatter and paths differ because adapters own host syntax.

## Provider selection

The built-in packs cover filesystem Issues, filesystem Design Docs, local Git, and disabled remote source control. The compiler rejects a selected provider when no matching pack exists. It does not insert placeholder behavior for GitHub, GitLab, Jira, Confluence, Jujutsu, or another future provider.

Provider packs contain provider-specific operation guidance. Canonical lifecycle templates contain no provider command names. A provider change replaces the compiled provider section and its provenance without changing lifecycle approval points, stop conditions, role points, or transitions.

See [SDLC provider selection](/configuration#sdlc-provider-selection) for the configuration fields. Issues #116 and #117 supply remote issue, document, and source-control packs.

## Runtime packages

Provider selection and package installation are separate inputs. Filesystem Issues and Design Docs usually need these explicit entries:

```ts
export const runtimePackages = [
  { logicalId: "issues" as const, version: "0.1.0" },
  { logicalId: "design-docs" as const, version: "0.1.0" },
];
```

Use the exact versions from the application or release manifest. The compiler sorts and validates this list, rejects duplicate IDs and version ranges, then asks the selected adapter to produce `config.package` operations. It never infers the list from `capabilities.issues` or `capabilities.documents`.

## Template layers

The packaged layer contains one template for each public command. Supply extra `TemplateLayer` values through `templateLayers`. Distribution resolves this precedence order:

1. packaged;
2. installed package;
3. global override;
4. project override.

An override replaces the complete template. It must retain each provider token and the role token exactly once. Token validation protects assembly but cannot prove that custom lifecycle prose preserves policy. Review override content before installation. The compiler records the selected and shadowed template sources.

## Role insertion points

Templates name portable roles rather than Pi or OpenCode agents. The published role vocabulary includes `planner`, `researcher`, `implementer`, `reviewer`, `verifier`, `release-coordinator`, and `documentation-writer`.

A role instruction identifies both a command and one allowed role. Compilation without role instructions remains valid and records the unassigned points. Assignment, required versus optional roles, current-agent fallback, model hints, and handoff rules belong to issue #118.

## Install the result

Pass `output.assets` to the distribution workflow:

```ts
const inspected = await inspectInstallation(output.assets, roots);
const proposed = createInstallationPlan(inspected, "install");
const authorized = authorizePlan(proposed, approvedConflictIds);
await applyInstallationPlan(authorized);
```

Review the complete plan before authorization. The installer mutates only receipt-owned paths or exact conflicts approved by ID. See [asset distribution](/distribution/) for roots, scopes, receipts, updates, rollback, and recovery.

## Reproducibility

Equivalent serialized inputs produce byte-identical compiler and asset manifest checksums. Deterministic ordering uses UTF-16 code units rather than locale-dependent sorting. Configuration provenance remains available for audit, while generated asset source checksums use semantic configuration values instead of absolute configuration file paths.
