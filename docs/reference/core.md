# Core greeting utility

`@neottia/core` currently contains a template-level greeting utility. It is not an SDLC coordinator.

```sh
pnpm add @neottia/core
```

The package root exports:

```ts
import { Greeter, hello, main } from "@neottia/core";

const greeter = new Greeter();
console.log(greeter.hello("World"));
console.log(greeter.goodbye("World"));
console.log(hello("World"));
main();
```

`Greeter.hello(name)` returns `Hello, <trimmed-name>!`; `Greeter.goodbye(name)` returns `Goodbye, <trimmed-name>!`. The root `hello` function uses a shared Greeter. `main()` logs `Hello, World!`. A top-level `goodbye` function exists in the internal module but is not exported from the package root.

The methods reject falsy or non-string input. Whitespace-only strings currently pass the initial check and produce an empty-name greeting after trimming.
