# Compile the canonical SDLC

`@neottia/sdlc` compiles six lifecycle commands into Pi or OpenCode prompt assets. The compiler chooses provider instructions before installation. Generated commands do not route between providers at runtime.

## Commands

| Command  | Instruction blocks                                 | Required behavior                                                                                                                       |
| -------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Plan     | Issues, Documents, local source control            | Read tracked work and repository evidence, define bounded scope, and stop for plan or design approval.                                  |
| Build    | Issues, Documents, local source control            | Require approved plan evidence, implement only that scope, and stop on ownership conflicts or unexpected changes.                       |
| Verify   | Issues, Documents, local and remote source control | Compare the change with requirements, run declared checks, and record failures before returning to Build.                               |
| Release  | Issues, local and remote source control            | Require approved scope and passing verification, prepare release evidence, and request explicit authorization for irreversible actions. |
| Continue | Issues, Documents, local and remote source control | Inspect durable evidence, recommend one next public command, and stop without running it.                                               |
| Refresh  | Issues, Documents, local and remote source control | Reload authoritative state, report drift, and avoid silent lifecycle transitions.                                                       |

Release instructions never authorize an autonomous merge, publication, or deployment. Every command states that workflow text does not grant host permissions.

## Inputs and outputs

`loadSdlcTemplateLayers()` reads published files and conventional overrides before compilation. Compilation then depends only on explicit values:

- one immutable configuration snapshot;
- packaged, installed-package, global, and project template layers;
- checksummed provider instruction packs;
- checksummed role instructions derived from the selected harness assignments;
- runtime package IDs with exact versions;
- one harness adapter and installation scope.

`createSdlcCompilerInput()` resolves template precedence, selects one instruction pack for each configured capability, and derives role instructions from the selected harness map. Each command template renders only the provider and role blocks that command uses. `compileSdlc()` records those rendered packs in the command provenance, then projects the six prompts, supported native role agents, and explicit package configuration through the adapter. The returned output manifest contains semantic command records and a checksummed distribution `AssetManifest`.

The compiler does not read files, invoke Git, contact providers, install packages, or change host configuration.

## Basic use

```ts
import { resolveHostConfigSnapshot } from "@neottia/config-registry";
import { piHarnessAdapter, piHarnessDeclaration } from "@neottia/pi-adapter";
import { compileSdlc, createSdlcCompilerInput, loadSdlcTemplateLayers } from "@neottia/sdlc";

const snapshot = resolveHostConfigSnapshot({
  cwd: process.cwd(),
  interactive: false,
  overrides: {
    agents: {
      sdlc: {
        pi: {
          planner: { agent: "current" },
          implementer: { agent: "current" },
          verifier: { agent: "current" },
          "release-coordinator": { agent: "current" },
        },
      },
    },
  },
});

const templateLayers = await loadSdlcTemplateLayers({
  projectRoot: process.cwd(),
});
const input = createSdlcCompilerInput(snapshot, {
  compilerVersion: "0.1.0",
  harnessId: "pi",
  harnessDeclaration: piHarnessDeclaration,
  scope: "project",
  templateLayers,
  runtimePackages: [
    { logicalId: "issues", version: "0.1.0" },
    { logicalId: "design-docs", version: "0.1.0" },
  ],
});

export const output = compileSdlc(input, piHarnessAdapter);
```

Compile once per harness and scope. The selected harness must explicitly assign `planner`, `implementer`, `verifier`, and `release-coordinator`. Use `agent: current` when the current agent performs a required role. Pi and OpenCode preserve the same role contracts, but their assignment maps, frontmatter, and paths differ because adapters own host syntax. See [portable role assignments](/sdlc/roles).

## Provider selection

The built-in packs cover filesystem Issues, filesystem Design Docs, local Git, disabled remote source control, GitHub, GitLab, Gitea, Forgejo, Jira, Confluence, and Bitbucket. Jujutsu still fails before projection unless the caller supplies a matching pack.

Provider bundles contain separate checksummed fragments for each supported slot. GitHub and GitLab support Issues, Git-backed wikis, and remote source-control work through their documented CLIs. Gitea and Forgejo require a configured command-backed MCP service for Issues and remote provider objects. Their Documents selections fail as unsupported rather than claiming wiki parity. Jira Issues, Confluence Documents, and Bitbucket remote source control also require configured MCP services. These three products keep independent connections, credentials, capability semantics, and provenance.

Canonical lifecycle templates contain no provider command names. They omit instruction blocks that a command does not use. A provider change affects only commands that render the selected block and does not change lifecycle approval points, stop conditions, role points, or transitions.

See [SDLC provider selection](/configuration#sdlc-provider-selection) for the capability fields and [provider instruction-pack configuration](/sdlc/providers) for connections, authentication, MCP requirements, tool checks, and troubleshooting.

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

The package publishes six `.md.twig` command files, their shared `layout.md.twig`, and `lifecycle.json` under `templates/`. The JSON file contains command descriptions, approval text, and stop-condition text. TypeScript retains stable IDs and graph structure, not rendered lifecycle prose. Twing renders the resolved template from an in-memory loader with strict missing-variable checks and Markdown output without HTML escaping.

`loadSdlcTemplateLayers()` resolves this precedence order:

1. packaged files;
2. explicit installed-package layers;
3. a global override;
4. a project override.

A project can replace one complete command at `.neottia/templates/sdlc/<command>.md.twig`. Valid command filenames are `plan.md.twig`, `build.md.twig`, `verify.md.twig`, `release.md.twig`, `continue.md.twig`, and `refresh.md.twig`. An unknown filename fails loading. The same convention applies below the supplied global root.

The Twig context has three top-level values:

- `command` contains the canonical command ID, transitions, approval points, stop conditions, roles, and enforcement mode;
- `instructions` contains the selected Issues, Documents, local source-control, and remote source-control fragments;
- `roles` contains one ordered entry for each command role, including its ID, rendered fragment, assignment state, and optional instruction ID.

The shared layout exposes one named Twig block per instruction slot. Command templates override blocks they do not need with an empty block. The renderer rejects duplicate instruction fragments and requires every role fragment exactly once. It also rejects dynamic template dependencies, recursive inheritance, unbounded `range()`, includes, and nondeterministic functions such as `random()`. These checks protect template assembly but cannot prove that replacement prose preserves lifecycle policy. Review complete overrides before installation. Compiler provenance records the rendered instruction packs, selected template, and every shadowed source.

## Role assignments

Templates name portable roles rather than Pi or OpenCode agents. The published role vocabulary includes `planner`, `researcher`, `implementer`, `reviewer`, `verifier`, `release-coordinator`, and `documentation-writer`.

Configuration under `agents.sdlc.<harness>` assigns each role to the current agent, a supported named agent, or `false`. The compiler requires explicit assignments for `planner`, `implementer`, `verifier`, and `release-coordinator`. An omitted or disabled optional role falls back to the current agent, so lifecycle work is never silently skipped.

Each generated role fragment states its objective, availability requirements, host-aware hint behavior, bounded handoff, result evidence, and authorization limits. OpenCode can receive native named subagent assets. Pi accepts current-agent assignments only and receives the same duties inside command prompts. See [portable role assignments](/sdlc/roles) for the schema, host differences, and examples.

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
