---
"@neottia/repository-store": patch
---

Treat a lease file unlinked during verified owner reads as normal identity contention while preserving fail-closed hard-link checks.
