---
"@neottia/design-docs": minor
"@neottia/issues-design-docs": minor
---

Migrate Design Docs configuration loading to the shared resolver, export its typed contribution and default-free patch schemas, and preserve standalone aliases, environment bindings, defaults, limits, storage, and tools.

Resolve Issues and Design Docs from one captured configuration snapshot so cross-domain callbacks cannot observe separate file states.
