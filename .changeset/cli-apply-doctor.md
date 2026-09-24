---
"@neottia/cli": minor
---

Add the config-driven lifecycle workflow: `neottia apply` compiles and installs the SDLC lifecycle from project configuration for every configured harness (skipping conflicting files with per-file warnings and a non-zero exit), `neottia doctor` validates configuration and statically reports missing modules and installs, and `neottia init` validates an existing `.neottia/config.yml` instead of refusing to touch it. A compatibility catalog pins exact runtime package versions per harness, never resolved from a registry. The advanced manifest-driven commands remain unchanged.
