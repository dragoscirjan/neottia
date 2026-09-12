# Memory import and export

`memory_export` returns JSONL containing every record and tombstone. Treat it as a portable validated representation. Filesystem canonical YAML remains the Git authority; PostgreSQL backup remains a database operation.

Memory import differs from Issues and Design Docs because omission currently commits. Preview explicitly:

```ts
const preview = await store.import(content, true);
if (preview.valid) {
  await store.import(content, false);
}
```

Import validates every line, identity, supersession edge, tombstone, namespace, secret rule, and configured limit before committing. Resolve collisions and invalid references before the second call. A cache warning after publication does not invalidate canonical data; rebuild the disposable cache.

Moving between filesystem and PostgreSQL is an export/import migration, not a live backend switch. Keep a raw backup of the source authority until validation succeeds in the target.
