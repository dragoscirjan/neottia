# Issue, design, and memory workflow

This direct-library example uses the same shared tool registries as Pi, OpenCode, and MCP. It carries each returned revision into the next mutation.

```ts
import { closeDesignDocsToolContext, findDesignDocsTool, type DocumentRecord } from "@neottia/design-docs";
import { closeIssueToolContext, findIssueTool, type Issue } from "@neottia/issues";
import { createIssuesDesignDocsComposition } from "@neottia/issues-design-docs";
import { closeMemoryToolContext, findMemoryTool } from "@neottia/memory-core";

const cwd = process.cwd();
const composition = createIssuesDesignDocsComposition({ cwd });
const issues = { cwd, interactive: false, resolver: composition.resolver, storeKey: {} };
const documents = { cwd, interactive: false, linkValidator: composition.linkValidator, storeKey: {} };
const memory = { cwd, interactive: false, storeKey: {} };
const required = <T>(value: T | undefined, name: string): T => {
  if (!value) throw new Error(`Missing tool: ${name}`);
  return value;
};

try {
  const issue = (await required(findIssueTool("issue_create"), "issue_create").run(issues, {
    type: "story",
    title: "Add a deployment status page",
    created_by: "user:owner",
  })) as Issue;
  const draft = (await required(findDesignDocsTool("document_create"), "document_create").run(documents, {
    title: "Deployment status page",
    kind: "hld",
    created_by: "user:owner",
    body: "Describe the deployment status page and its data sources.",
  })) as DocumentRecord;
  const linked = (await required(findIssueTool("issue_link_document"), "issue_link_document").run(issues, {
    id: issue.id,
    document_id: draft.id,
    expected_revision: issue.revision,
  })) as Issue;
  const review = (await required(findDesignDocsTool("document_transition"), "document_transition").run(documents, {
    id: draft.id,
    expected_revision: draft.revision,
    to: "review",
    intent: "Request review of the deployment design.",
    actor: "user:owner",
    evidence: { source: "caller-attestation", note: "The owner requested review in this session." },
  })) as DocumentRecord;
  await required(findDesignDocsTool("document_validate"), "document_validate").run(documents, {
    cross_domain: true,
  });
  const approved = (await required(findDesignDocsTool("document_transition"), "document_transition").run(documents, {
    id: review.id,
    expected_revision: review.revision,
    to: "approved",
    intent: "Approve the reviewed deployment design.",
    actor: "user:owner",
    evidence: { source: "caller-attestation", note: "The owner approved this revision." },
  })) as DocumentRecord;
  const unlinked = (await required(findIssueTool("issue_unlink_document"), "issue_unlink_document").run(issues, {
    id: linked.id,
    document_id: approved.id,
    expected_revision: linked.revision,
  })) as Issue;
  const pinned = (await required(findIssueTool("issue_link_document"), "issue_link_document").run(issues, {
    id: unlinked.id,
    document_id: approved.id,
    document_version: approved.version,
    expected_revision: unlinked.revision,
  })) as Issue;
  const successor = (await required(findDesignDocsTool("document_version"), "document_version").run(documents, {
    id: approved.id,
    expected_revision: approved.revision,
    body: "Describe the data sources, update interval, and incident state.",
  })) as DocumentRecord;
  const done = (await required(findIssueTool("issue_transition"), "issue_transition").run(issues, {
    id: pinned.id,
    status: "done",
    expected_revision: pinned.revision,
  })) as Issue;
  const decision = await required(findMemoryTool("memory_store"), "memory_store").run(memory, {
    memory_type: "episodic",
    record_type: "decision",
    summary: "Use the approved deployment status design.",
    source: { kind: "artifact", ref: approved.id, revision: approved.revision },
    created_by: "user:owner",
    confidence: "verified",
    tags: ["deployment"],
  });
  console.log(done.status, successor.version, decision);
} finally {
  await Promise.all([
    closeIssueToolContext(issues),
    closeDesignDocsToolContext(documents),
    closeMemoryToolContext(memory),
  ]);
}
```

Before running it, enable `skills.issues`, `skills.design_docs`, and `skills.memory` in `.neottia/config.yml`. Expected results are a done issue, approved document version 1, draft successor version 2, a pinned issue link to version 1, and an artifact-sourced Memory decision. Commit canonical YAML and Markdown, not caches or Repository Store control state.
