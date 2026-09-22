# Release metadata

`@neottia/release` is a published bill-of-materials package. It has no JavaScript entry point. Install it with `pnpm add @neottia/release`, then inspect the packed `release-manifest.json` file.

The manifest shape is:

```json
{
  "version": "0.2.1",
  "modules": {
    "@neottia/config": "0.2.0",
    "@neottia/core": "0.1.0"
  }
}
```

The published file contains the complete module map for its global release. Compatibility claims apply only to module entries present in that manifest.

CI or deployment tooling can resolve and read the packed file:

```js
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageFile = require.resolve("@neottia/release/package.json");
const manifest = JSON.parse(await readFile(join(dirname(packageFile), "release-manifest.json"), "utf8"));
console.log(manifest); // {version: "0.2.1", modules: {"@neottia/config": "0.2.0", ...}}
```

Check `version`, then compare the required module entries. The package manifest pins every listed module as an exact dependency.

Changesets manages module versions and publication. Maintainers prepare the global package with `mise run release:global -- <semver>`. The `CI » Release` workflow publishes the prepared global package after every pinned module version is available from npm. The root repository README documents the complete maintainer flow and the npm environment secret it uses.
