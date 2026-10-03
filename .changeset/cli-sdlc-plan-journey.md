---
"@neottia/cli": minor
---

Add the config-driven `neottia sdlc plan` command and the `init --preset local` option, completing the empty-project adoption journey: `init` → `sdlc plan` → inspect the saved plan → `apply --plan` → `doctor`. `sdlc plan` compiles the configured lifecycle exactly like `apply`, writes the reviewable installation plan to `--output` (mutations, checksums, conflicts, reload notice) and optionally the compiled manifest to `--manifest` for `neottia doctor --manifest` diagnostics; it exits 2 while unapproved conflicts remain and supports `--approve <conflict-id>`. Re-running a saved plan is idempotent, update plans are bounded to changed assets, and uninstall stays receipt-driven.
