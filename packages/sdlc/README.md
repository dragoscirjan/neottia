# @neottia/sdlc

`@neottia/sdlc` compiles one canonical Plan, Build, Verify, Release, Continue, and Refresh lifecycle into assets for a Neottia harness adapter. Compilation is pure. It returns a checksummed `AssetManifest` for `@neottia/distribution` and does not read files, run providers, or install assets.

See the [SDLC compiler guide](../../docs/sdlc/) and [configuration reference](../../docs/configuration.md#sdlc-provider-selection).

## Compile a lifecycle

Resolve configuration before calling the compiler. The compiler reads only the supplied snapshot, template layers, instruction packs, role instructions, runtime package versions, and adapter.

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
const compilation = compileSdlc(input, piHarnessAdapter);
export const manifest = compilation.assets;
```

Use the installed package versions in `runtimePackages`. The compiler does not infer packages from provider selections. A change from filesystem Issues to GitHub Issues does not add, remove, or version a package.

## Built-in instruction packs

The package includes checksummed packs for:

- filesystem Issues;
- filesystem Design Docs;
- local Git;
- disabled remote source control.

A selected provider without a supplied pack fails before adapter projection. Issues #116 and #117 add remote provider packs.

## Templates and roles

Canonical templates contain provider and role insertion tokens. `resolveTemplates()` applies the distribution precedence order: packaged, package, global, then project. Every resolved template and shadowed source appears in compiler input provenance.

The compiler publishes portable role invocation points such as `planner`, `implementer`, `verifier`, and `release-coordinator`. Optional checksummed role instructions can fill those points. This package does not define assignment, requiredness, or fallback policy. Issue #118 owns those rules.

## Safety boundaries

Generated prompts preserve lifecycle approvals, evidence requirements, stop conditions, and transitions across Pi and OpenCode. Their permission language is guidance. It does not grant filesystem, process, network, merge, release, or deployment authority.

`continue` recommends a next command and stops. `release` never grants permission to merge, publish, or deploy.
