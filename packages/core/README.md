# @neottia/core

Template-level greeting utility. It is not a shared SDLC coordinator.

```sh
pnpm add @neottia/core
```

```ts
import { Greeter, hello, main } from "@neottia/core";

console.log(hello("World"));
console.log(new Greeter().goodbye("World"));
main();
```

The root exports `Greeter`, `hello`, and `main`. `Greeter` has `hello` and `goodbye`; the package root does not export a standalone `goodbye`.

Read the [Core reference](https://github.com/dragoscirjan/neottia/blob/main/docs/reference/core.md).
