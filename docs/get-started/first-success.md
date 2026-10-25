# Run the first useful workflow

Start with a planning task. It proves that the lifecycle loaded, can read the repository, and can write durable work records without changing product code.

## 1. Ask for a small plan

In Pi, OpenCode, or Claude Code, run a request like:

```text
/plan Add a short contributor note that explains how to run the project's existing validation command.
```

Choose a real but small outcome in your repository. The Plan command should:

1. inspect the request, configuration, tracked work, and repository evidence;
2. create or update one owning Epic and any required child work or design record;
3. describe the bounded implementation and validation evidence;
4. stop for explicit scope approval.

It must not silently run Build.

## 2. Inspect the evidence

Run:

```sh
git status --short
```

For the default filesystem providers, review the new or updated files under:

- `.neottia/issues/` for the owning Epic and child work;
- `.neottia/design-docs/` when the change needs a reviewed design record;
- `.neottia/config.yml` for the selected providers and harness targets.

The exact record content depends on the request. The important result is that the plan is reviewable and the command stopped at its approval boundary.

## 3. Decide whether to continue

- Approve the recorded scope, then invoke `/build` yourself.
- Reject or narrow the scope, then rerun `/plan` with the correction.
- Use `/continue` later to ask which one public command the current evidence supports.
- Use `/refresh` when repository or provider state changed and you want a drift report without a lifecycle transition.

Read [the lifecycle and authority boundaries](/learn/lifecycle) before using `/release`.

## Optional capability smoke tests

The lifecycle is the normal user path. The following direct tool calls are useful when you want to test each enabled capability independently.

### Store a memory

Call [`memory_store`](/memory/tools) with:

```json
{
  "memory_type": "semantic",
  "record_type": "fact",
  "summary": "Deploy the website with pnpm.",
  "source": { "kind": "user-confirmed", "ref": null, "revision": null },
  "created_by": "user:owner",
  "confidence": "confirmed",
  "tags": ["deployment"]
}
```

The filesystem backend writes canonical YAML below `.neottia/memory/facts/`.

### Create an issue

Call [`issue_create`](/issues/tools) with:

```json
{ "type": "story", "title": "Add a deployment status page", "created_by": "user:owner" }
```

The canonical file is `.neottia/issues/<id>-<title-slug>.yml`.

### Create a design document

Call [`document_create`](/design-docs/tools) with:

```json
{
  "title": "Deployment status page",
  "kind": "hld",
  "created_by": "user:owner",
  "body": "Describe the deployment status page and its data sources."
}
```

The canonical Markdown file is written below `.neottia/design-docs/`.

### Stash and find a web page

Call [`web_stash`](/searchable/tools) with:

```json
{
  "url": "https://example.com/deployment-guide",
  "title": "Deployment guide",
  "content": "Deploy the website with pnpm and verify the status endpoint."
}
```

Then call `web_grep` with `{"query":"status endpoint"}`. The result should include the stashed URL.

Track canonical files and ignore caches as described in [Repository files](/guides/repository-files).
