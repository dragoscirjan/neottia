# Shared configuration

Put project configuration in `.neottia/config.yml`. The root requires `version: 1`; each package reads only its own `skills` shard.

```yaml
version: 1
skills:
  memory:
    enabled: true
  issues:
    enabled: true
  design_docs:
    enabled: true
```

Every shard is disabled by default. Searchable also has a shard, but enabling it does not create services or a runtime.

Values resolve in this order:

```text
explicit library override
listed environment binding
.neottia/config.yml
schema default
```

`NEOTTIA_CONFIG_FILE` selects another file. Each domain also has a package-specific file variable and a `NEOTTIA_CONFIG_<DOMAIN>_PATH` shard selector. Only environment variables listed on the domain configuration page work.

Use the generated schemas shipped with the packages for editor and CI validation:

- [Memory schema](https://github.com/dragoscirjan/neottia/blob/main/packages/memory-core/config.schema.json)
- [Issues schema](https://github.com/dragoscirjan/neottia/blob/main/packages/issues/config.schema.json)
- [Design Docs schema](https://github.com/dragoscirjan/neottia/blob/main/packages/design-docs/config.schema.json)
- [Searchable schema](https://github.com/dragoscirjan/neottia/blob/main/packages/searchable-core/config.schema.json)

Read the [Memory](/memory/configuration), [Issues](/issues/configuration), [Design Docs](/design-docs/configuration), or [Searchable](/searchable/configuration) reference for defaults and bindings.
