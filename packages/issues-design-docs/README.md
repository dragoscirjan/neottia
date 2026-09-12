# @neottia/issues-design-docs

Cycle-free composition for Neottia Issues and Design Docs. The package supplies a Design Docs reference resolver for `IssueStore` and an Issues link validator for `DesignDocumentStore` without making either domain depend on the other.

```sh
pnpm add @neottia/issues-design-docs @neottia/issues @neottia/design-docs
```

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

Pass `composition.resolver` to `IssueStore` and `composition.linkValidator` to `DesignDocumentStore`. Both integrations load configuration lazily. Enable both `skills.issues` and `skills.design_docs`; explicit cross-domain validation fails closed with `ISSUES_DISABLED` when Issues is disabled.

References use stable IDs: `{kind: "design-doc", id, version?}`. Unpinned links resolve the latest version, pinned links resolve exact history, and archived versions remain addressable. Validation reads both active and archived canonical Issues. All work runs under the repository lease supplied by the calling domain; the composition never reacquires that lease.

Read the [complete composition guide](https://github.com/dragoscirjan/neottia/blob/main/docs/issues/design-docs.md).
