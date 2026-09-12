# Issues and Design Docs composition

`@neottia/issues-design-docs` returns a Design Docs resolver for Issues and an Issues link validator for Design Docs. Wire both seams:

```ts
import { DesignDocumentStore, loadDesignDocsConfig } from "@neottia/design-docs";
import { IssueStore, loadIssueConfig } from "@neottia/issues";
import { createIssuesDesignDocsComposition } from "@neottia/issues-design-docs";

const cwd = process.cwd();
const composition = createIssuesDesignDocsComposition({ cwd });
const issues = new IssueStore(loadIssueConfig(cwd), cwd, {
  resolver: composition.resolver,
});
const documents = await DesignDocumentStore.fromConfig(loadDesignDocsConfig(cwd), cwd, {
  linkValidator: composition.linkValidator,
});
console.log(await issues.validate(), await documents.validate());
```

Both shards must be enabled. Configuration loads lazily. The composition works under the calling domain's existing Repository Store lease and does not reacquire it.

Unpinned document links resolve the latest version; pinned links resolve exact history. Archived documents remain addressable. Disabled targets, unresolved references, malformed resolver batches, and result limits fail without changing canonical files. Pi, OpenCode, and MCP install this composition by default unless the embedder supplies a custom seam.
