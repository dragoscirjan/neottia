# Issues library

Install the public package:

```sh
pnpm add @neottia/issues
```

Create a project store and run a shared tool:

```ts
import { IssueStore, findIssueTool, loadIssueConfig } from "@neottia/issues";

const cwd = process.cwd();
const store = new IssueStore(loadIssueConfig(cwd, { enabled: true }), cwd);
const issue = await store.create({
  type: "story",
  title: "Add a deployment status page",
  created_by: "user:owner",
});
const validate = findIssueTool("issue_validate");
const report = await validate?.run({ cwd, interactive: false }, {});
console.log(issue.id, issue.revision, report); // issue-<ULID>, v1:<sha256>, valid report
```

The package root exports config, schemas, codecs, graph and catalog helpers, `IssueStore`, errors, resolver contracts, tool schemas, `ISSUE_TOOLS`, and context cleanup. Registry contexts accept CWD, interactivity, cancellation, overrides, stale-cache callbacks, and an optional Design Docs resolver.
