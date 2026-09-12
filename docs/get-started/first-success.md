# First success

Run a tool host with its working directory set to your project, such as `acme/website`. Enable the three shards as shown in [shared configuration](/get-started/configuration).

## Store a memory

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

The result contains a generated ULID. The filesystem backend writes canonical YAML below `.neottia/memory/facts/`. `index.db`, `index.db-wal`, and `index.db-shm` are disposable.

## Create an issue

Call [`issue_create`](/issues/tools) with:

```json
{ "type": "story", "title": "Add a deployment status page", "created_by": "user:owner" }
```

The result contains an `issue-<ULID>` ID and revision. The canonical file is `.neottia/issues/<id>-<title-slug>.yml`. `.neottia/cache/issues.sqlite` is disposable.

## Create a design document

Call [`document_create`](/design-docs/tools) with:

```json
{
  "title": "Deployment status page",
  "kind": "hld",
  "created_by": "user:owner",
  "body": "Describe the deployment status page and its data sources."
}
```

The result is draft version 1 with an ID and revision. The canonical Markdown has a deterministic filename below `.neottia/design-docs/`. `.neottia/cache/design-docs.sqlite` is disposable.

Track canonical files and ignore caches as described in [Repository files](/guides/repository-files).
