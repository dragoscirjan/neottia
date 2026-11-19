# TypeScript initialization rules

Prerequisite: Read [project foundation](project.md) first. If already loaded for this task, do not read it again. The approved mise/Node/pnpm foundation must already exist; missing foundation setup requires separate approval.

## Project shape

- Establish application versus library, runtime targets, module system, emit/declaration policy, source/test/output paths, package exports, and test runner from project evidence.
- Do not infer these from one filename or convert working JavaScript, bundlers, module systems, or test runners implicitly.
- The test path must not equal or contain the source path; otherwise the build excludes all inputs.
- The [helper](../scripts/typescript/init.ts) supports Node/browser, ESM/CommonJS, and app/library shapes. Dual packages, other runtimes, custom emit policies, or conflicting existing configuration require a revised plan, not forced templates.

## Configuration and dependencies

- Keep `tsconfig` project-owned. Derive strictness, resolution, libraries, declarations, source maps, includes/excludes, and output paths from actual runtime and publishing contracts. Prefer `noEmit` when another approved tool emits code.
- Preserve ignores, generated-file boundaries, and existing compatible packages. New packages belong in `package.json` and pnpm's lockfile.
- Language dependencies: TypeScript; ESLint + `@tempel/eslint`; Prettier + `@tempel/prettier`; Vitest + `@tempel/vitest` only when no other runner is selected; runtime types such as `@types/node` only for applicable targets.
- Use documented [Tempel APIs](https://github.com/dragoscirjan/tempel-javascript) and satisfy their peer/engine requirements. `@tempel/tsconfig` is unmaintained. Do not install multiple runners merely to offer choices.
- Derive Vitest discovery globs from approved source/test paths. A global-API preset needs `vitest/globals` in the type contract.
- Package scripts own `typecheck`, non-watch `test`, optional `test:watch`, and the selected `build`. Add namespaced mise tasks such as `typecheck:typescript`; append aggregate dependencies and reuse shared lint/format/duplicate/audit checks when their scope already applies.

## Helper usage

Run from the `init-project` directory:

```text
bun scripts/typescript/init.ts --help
bun scripts/typescript/init.ts --root /absolute/project --runtime node --module esm --kind app --node-types 24.19.2
```

The JSON plan exposes proposed contents and pinned dependencies. `--apply --confirm` writes approved files; `--install` additionally re-trusts mise and runs pnpm, so both require explicit consent. Unknown shapes and mismatching existing files stop before writes.

## Language verification

Check TypeScript/Node/Tempel compatibility, runtime behavior, type checking, discovery globs, builds, emitted declarations/exports/source maps, and aggregate `mise run validate`. A type-only result does not establish runtime correctness; unchecked runtimes, build outputs, and coverage remain gaps.
