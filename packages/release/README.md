# @neottia/release

Published Neottia release bill of materials. The package has no JavaScript entry point; read its packed `release-manifest.json`.

```sh
pnpm add @neottia/release
```

Read the packed manifest from Node.js:

```js
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageFile = require.resolve("@neottia/release/package.json");
const manifest = JSON.parse(await readFile(join(dirname(packageFile), "release-manifest.json"), "utf8"));
console.log(manifest.version, manifest.modules);
```

The checked-in 0.1.0 snapshot prints `0.1.0` and an object containing only `@neottia/core: 0.1.0`. Compatibility claims apply only to module entries present in a published manifest. Release preparation is maintainer work documented in the repository root README.

Read the [Release metadata reference](https://github.com/dragoscirjan/neottia/blob/main/docs/reference/release.md).
