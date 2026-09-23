---
"@neottia/cli": minor
---

Add `neottia init` to create the minimal project-local SDLC configuration. The repeatable `--harness` option accepts `pi` and `opencode`, writes one project installation target and one required-role map per selected harness, validates the result through the official configuration registry, and never replaces an existing `.neottia/config.yml`.
