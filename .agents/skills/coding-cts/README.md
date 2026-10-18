# CTS coding

`coding-cts` adds `.cts` TypeScript CommonJS semantics to [`coding-ts`](../coding-ts/SKILL.md) and the generic [`coding`](../coding/SKILL.md) workflow.

## Scope

- TypeScript CommonJS classification and `.cjs` output
- compiler-aware module syntax
- type-only imports without runtime changes
- asynchronous ESM interoperability
- `.d.cts` declarations and package `require` exports
- dual-package state hazards

Reference: [TypeScript modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html).

## Dependencies

Load `coding`, `coding-ts`, and `coding-cts` in that order. All are sibling skills. Stop when a dependency is unavailable; do not install it automatically.

## Invocation

- Pi: `/skill:coding-cts`
- OpenCode: `/coding-cts`

See [issue 17](https://github.com/dragoscirjan/ai/issues/17) for the implementation requirements.
