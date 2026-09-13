---
"@neottia/config": patch
"@neottia/design-docs": patch
"@neottia/issues": patch
"@neottia/repository-store": patch
"@neottia/searchable-core": patch
---

Bound root configuration file size and YAML structure before conversion, reject blocking special files before reading, validate every environment binding against its contribution schema, accept empty reserved root sections, reject credentials in Searchable service endpoints, and enforce portable Windows-safe managed paths in runtime and generated schemas. Design Docs roots now require printable ASCII characters so editor schemas and runtime checks reject the same Unicode-normalized reserved paths.
