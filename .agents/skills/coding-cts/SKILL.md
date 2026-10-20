---
name: coding-cts
description: Write, refactor, review, or test .cts TypeScript with CommonJS output, compiler-aware module syntax, declaration compatibility, and asynchronous ESM interoperability. Use whenever a .cts file is changed.
compatibility: Requires the coding and coding-ts skills and a TypeScript toolchain configured for CommonJS semantics.
metadata:
  author: dragoscirjan
  version: "1.0"
  opencode/slash: "true"
---

# CTS coding

Apply `coding`, then `coding-ts`, then this extension-specific guidance.

## Load dependencies

Locate the advertised `coding` and `coding-ts` skills by exact name and path. Read their `SKILL.md` files in that order unless they are already loaded.

If either dependency is unavailable, stop and ask the human to install or expose it. Do not install it automatically, duplicate its instructions, or rely on a harness-specific Skill tool.

## Preserve TypeScript CommonJS semantics

Use the [TypeScript modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html) and the project's runtime documentation.

- Treat `.cts` as CommonJS. With TypeScript's Node-aware modes, it emits a `.cjs` file and uses `.d.cts` declarations.
- Preserve the configured `module`, `moduleResolution`, and `verbatimModuleSyntax` behavior. Use only module syntax that those settings permit.
- Keep the public export shape compatible with existing CommonJS consumers.
- Use type-only imports and exports without changing required runtime loading.
- Use dynamic `import()` for ESM interoperability when supported, and handle its asynchronous namespace result explicitly.
- Do not add top-level `await`; CommonJS initialization remains synchronous.
- Preserve package `exports` `require` conditions and avoid parallel ESM and CommonJS instances of stateful code.

Run the inherited TypeScript gates. Verify type checking, emitted or bundled CommonJS behavior, declaration output when published, and execution through the target CommonJS loader.
