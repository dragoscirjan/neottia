# @neottia/sdlc

`@neottia/sdlc` compiles one canonical Plan, Build, Verify, Release, Continue, and Refresh lifecycle into assets for a Neottia harness adapter. The package ships six Markdown/Twig templates and loads them before pure compilation. The compiler returns a checksummed `AssetManifest` for `@neottia/distribution` and does not read files, run providers, or install assets.

See the [SDLC compiler guide](../../docs/sdlc/) and [configuration reference](../../docs/configuration.md#sdlc-provider-selection).

## Compile a lifecycle

Resolve configuration before calling the compiler. The compiler reads only the supplied snapshot, template layers, instruction packs, role instructions, runtime package versions, and adapter.

```ts
import { resolveHostConfigSnapshot } from "@neottia/config-registry";
import { piHarnessAdapter } from "@neottia/pi-adapter";
import { compileSdlc, createSdlcCompilerInput, loadSdlcTemplateLayers } from "@neottia/sdlc";

const snapshot = resolveHostConfigSnapshot({
  cwd: process.cwd(),
  interactive: false,
});

const templateLayers = await loadSdlcTemplateLayers({
  projectRoot: process.cwd(),
});
const input = createSdlcCompilerInput(snapshot, {
  compilerVersion: "0.1.0",
  harnessId: "pi",
  scope: "project",
  templateLayers,
  runtimePackages: [
    { logicalId: "issues", version: "0.1.0" },
    { logicalId: "design-docs", version: "0.1.0" },
  ],
});
const compilation = compileSdlc(input, piHarnessAdapter);
export const manifest = compilation.assets;
```

Use the installed package versions in `runtimePackages`. The compiler does not infer packages from provider selections. A change from filesystem Issues to GitHub Issues does not add, remove, or version a package.

## Built-in instruction packs

The package includes checksummed fragments for filesystem Issues, filesystem Design Docs, local Git, disabled remote source control, GitHub, GitLab, Gitea, and Forgejo.

GitHub uses the documented `gh` CLI. GitLab uses `glab`. Both include Git-backed wiki guidance. Gitea and Forgejo require a configured MCP service for Issues and remote forge objects. Their Documents selections fail before adapter projection because this package does not claim undocumented wiki parity.

Forge connection settings live at `connections.forges`. A selected connection supplies a validated base URL, a credential environment-variable name, and optional capability-specific `{server, command}` MCP entries. The compiler includes only selected connections and fragments in its checksummed input. Each command template renders only the instruction blocks it uses.

See the [forge provider guide](../../docs/sdlc/providers.md) for configuration, installation, authentication, supported operations, tool checks, mutation safety, and troubleshooting. A selected Jira, Confluence, Bitbucket, or Jujutsu provider still fails when no caller-supplied pack exists.

## Templates and roles

The package publishes `templates/plan.md`, `build.md`, `verify.md`, `release.md`, `continue.md`, and `refresh.md`, plus their shared `layout.md` and `lifecycle.json` prose. Twing renders the selected command with strict variables and no HTML escaping. The shared layout has one named block per instruction slot, and command templates leave unused blocks empty. The renderer rejects nondeterministic Twig functions, duplicate instruction fragments, and missing or duplicate role fragments.

Place a complete project override at `.neottia/templates/sdlc/<command>.md`. The loader rejects unknown filenames. It applies packaged, package, global, then project precedence and records selected and shadowed checksums in compiler input provenance. A whole-template override can change lifecycle policy, so review it before installation.

The Twig context exposes `command`, `instructions`, and `roles`. Provider and role packages supply checksummed fragments through those fields instead of owning command templates. The compiler publishes portable role names such as `planner`, `implementer`, `verifier`, and `release-coordinator`. Issue #118 owns assignment, requiredness, and fallback policy.

## Safety boundaries

Generated prompts preserve lifecycle approvals, evidence requirements, stop conditions, and transitions across Pi and OpenCode. Their permission language is guidance. It does not grant filesystem, process, network, merge, release, or deployment authority.

`continue` recommends a next command and stops. `release` never grants permission to merge, publish, or deploy.
