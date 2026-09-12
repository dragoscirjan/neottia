# Design Docs library

Install the public TypeScript package:

```sh
pnpm add @neottia/design-docs
```

Create a store for the current project:

```ts
import { DesignDocumentStore, loadDesignDocsConfig } from "@neottia/design-docs";

const cwd = process.cwd();
const config = loadDesignDocsConfig(cwd, { enabled: true });
const store = await DesignDocumentStore.fromConfig(config, cwd);
const document = await store.create({
  title: "Deployment status page",
  kind: "hld",
  created_by: "user:owner",
  body: "Describe the data sources.",
});
console.log(document.id, document.revision); // doc-<ULID>, v1:<sha256>
```

The store exposes identity allocation, create, get, list, search, update, transition, version, validate, archive, restore, export, import, and under-lease address resolution. Package exports also include schemas, codecs, error serialization, config constants, and `DESIGN_DOCS_TOOLS` with `findDesignDocsTool`.

To call a shared tool, find it and pass `{cwd, interactive, signal?, configOverrides?, onStaleCache?, linkValidator?}`. Close a routed registry context with `closeDesignDocsToolContext`. `DesignDocumentStore` retains no separate public close method.
