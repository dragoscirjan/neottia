# CJS coding

`coding-cjs` adds `.cjs` CommonJS semantics to [`coding-js`](../coding-js/SKILL.md) and the generic [`coding`](../coding/SKILL.md) workflow.

## Scope

The skill covers:

- `require` and CommonJS export shapes
- synchronous module initialization and cache identity
- package `require` entry points
- dynamic ESM interoperability
- CommonJS runtime globals
- dual-package state hazards

References:

- [Node.js CommonJS modules](https://nodejs.org/api/modules.html)
- [Node.js packages and module formats](https://nodejs.org/api/packages.html)

## Dependencies

Load `coding`, `coding-js`, and `coding-cjs` in that order. All are sibling skills. Stop when a dependency is unavailable; do not install it automatically.

## Invocation

- Pi: `/skill:coding-cjs`
- OpenCode: `/coding-cjs`

See [issue 17](https://github.com/dragoscirjan/ai/issues/17) for the implementation requirements.
