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

The manifest records the global release version and every module version included in that release. Compatibility claims apply only to module entries present in the published manifest. The repository root README documents release preparation.

Read the [Release metadata reference](https://github.com/dragoscirjan/neottia/blob/main/docs/reference/release.md).
