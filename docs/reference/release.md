# Release metadata

`@neottia/release` is a published bill-of-materials package. It has no JavaScript entry point. Install it with `pnpm add @neottia/release`, then inspect the packed `release-manifest.json` file.

The manifest shape is:

```json
{ "version": "0.1.0", "modules": { "@neottia/core": "0.1.0" } }
```

The checked-in 0.1.0 snapshot currently lists only `@neottia/core`. Do not infer versions for other workspace modules from this historical file. A global release identifies an exact module map only for entries present in that published manifest.

CI or deployment tooling can resolve and read the packed file:

```js
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageFile = require.resolve("@neottia/release/package.json");
const manifest = JSON.parse(await readFile(join(dirname(packageFile), "release-manifest.json"), "utf8"));
console.log(manifest); // {version: "0.1.0", modules: {"@neottia/core": "0.1.0"}}
```

Check `version`, then compare only required module entries. The package manifest also pins the Core dependency represented by this snapshot. Release preparation is maintainer work and is documented only in the root repository README.
