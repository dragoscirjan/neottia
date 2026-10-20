---
name: coding-cjs
description: Write, refactor, review, or test .cjs JavaScript with CommonJS loading, explicit export shapes, asynchronous ESM interoperability, and package compatibility. Use whenever a .cjs file is changed.
compatibility: Requires the coding and coding-js skills and a CommonJS runtime supported by the project.
metadata:
  author: dragoscirjan
  version: "1.0"
  opencode/slash: "true"
---

# CJS coding

Apply `coding`, then `coding-js`, then this extension-specific guidance.

## Load dependencies

Locate the advertised `coding` and `coding-js` skills by exact name and path. Read their `SKILL.md` files in that order unless they are already loaded.

If either dependency is unavailable, stop and ask the human to install or expose it. Do not install it automatically, duplicate its instructions, or rely on a harness-specific Skill tool.

## Preserve CommonJS semantics

Use the [Node.js CommonJS documentation](https://nodejs.org/api/modules.html) and the project's runtime documentation.

- Treat `.cjs` as CommonJS regardless of the nearest Node.js `package.json` `type` field.
- Use the export shape already exposed by the module. Do not switch between `module.exports` and property mutation without checking consumer behavior.
- Keep `require` resolution, cache identity, and initialization order in mind when moving code.
- Use dynamic `import()` for ESM interoperability when the runtime supports it. Treat the result as asynchronous and handle default and named exports explicitly.
- Do not add top-level `await`; CommonJS module evaluation is synchronous.
- Use `__filename` and `__dirname` only where the target runtime defines them.
- Preserve package `exports` `require` conditions and existing CommonJS entry points.
- Avoid loading parallel CommonJS and ESM copies of stateful code.

Run the inherited JavaScript gates and test the module through the project's real CommonJS loader, including its public export shape and ESM boundary when one exists.
