# Design document lifecycle

`document_create` creates version 1 in `draft`. `document_update` edits only the latest active draft or review and requires its exact revision.

Transition the returned document to review:

```json
{
  "id": "<returned document id>",
  "expected_revision": "<returned revision>",
  "to": "review",
  "intent": "Request review of the deployment design.",
  "actor": "user:owner",
  "evidence": { "source": "caller-attestation", "note": "The owner requested review in this session." }
}
```

Carry the new revision into a transition back to `draft` or onward to `approved`. Evidence sources are `human-ui`, `caller-attestation`, and `policy`. Caller attestation records a caller statement; it does not prove that a person clicked a control.

Approved versions are immutable. `document_version` requires the latest approved revision and creates the next contiguous version as a draft. It preserves prior bytes, the stable ID, and lineage. Use the successor for semantic changes.

`document_archive` and `document_restore` require the latest exact revision and move the complete lineage atomically. Archived versions remain addressable. There is no physical-delete tool.

The [cross-module workflow](/guides/issue-design-memory-workflow) executes create, review, approval, validation, and successor versioning with returned revisions. After it creates `successor`, complete the remaining operations through the same shared registry:

```ts
const search = await required(findDesignDocsTool("document_search"), "document_search").run(documents, {
  query: "deployment status",
  id: successor.id,
  all_versions: true,
});
const archived = await required(findDesignDocsTool("document_archive"), "document_archive").run(documents, {
  id: successor.id,
  expected_revision: successor.revision,
});
const restored = await required(findDesignDocsTool("document_restore"), "document_restore").run(documents, {
  id: successor.id,
  expected_revision: successor.revision,
});
const exported = await required(findDesignDocsTool("document_export"), "document_export").run(documents, {});
const preview = await required(findDesignDocsTool("document_import"), "document_import").run(documents, {
  content: exported.content,
  preview: true,
  format: "native",
});
console.log(search.hits, archived.location, restored.location, preview.valid);
```

The expected locations are `archive` and then `active`; importing the same exported state previews with no mutation. Archive and restore preserve canonical bytes, so the latest exact revision remains the required evidence.
