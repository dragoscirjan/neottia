---
aside: false
---

<script setup>
import { withBase } from 'vitepress'

const diagram = withBase('/diagrams/neottia-system.html')
</script>

# How Neottia fits together

Neottia separates portable lifecycle policy from host syntax and storage mechanics. A project configuration selects capabilities and harnesses. The compiler produces portable assets. Harness adapters project those assets into Pi, OpenCode, or Claude Code. Runtime capability packages then write canonical repository records through Repository Store.

<div class="diagram-links">
  <a :href="diagram" target="_blank" rel="noreferrer">Open the interactive system map in a new tab</a>
</div>

<div class="diagram-frame">
  <iframe :src="diagram" title="Interactive Neottia system map" loading="lazy"></iframe>
</div>

## Read the map from left to right

1. **Configuration** — `.neottia/config.yml` selects modules, providers, roles, and installation targets.
2. **Compilation** — the SDLC compiler renders six commands plus the shared operating protocol from explicit, checksummed inputs.
3. **Projection** — one harness adapter converts portable assets into host paths, frontmatter, package entries, and MCP settings.
4. **Installation** — the distribution layer plans mutations, rejects unowned conflicts, writes receipts, and supports rollback and recovery.
5. **Runtime** — native extensions or stdio MCP servers expose the same domain tools.
6. **Repository data** — canonical records are tracked with Git; SQLite indexes and Repository Store control state are disposable.

## The important boundaries

- The compiler does not write files, invoke Git, contact providers, or grant host permissions.
- Adapters describe host behavior but do not mutate the host directly.
- The installer changes only receipt-owned paths or exact conflicts that a user approved.
- Runtime tools use Repository Store for bounded mutation, lease control, journaling, durability, and recovery.
- Canonical records remain the source of truth. Caches can be rebuilt.

Continue with the [lifecycle and approval model](/learn/lifecycle) or the [runtime data flow](/learn/runtime-data). For diagram evidence, pinned revisions, and license information, see [diagram sources and attribution](/reference/diagrams).

<style scoped>
.diagram-links {
  margin: 1rem 0;
}
.diagram-frame {
  width: 100%;
  height: 760px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: #06111f;
}
.diagram-frame iframe {
  width: 100%;
  height: 100%;
  border: 0;
}
@media (min-width: 960px) {
  .diagram-frame {
    width: min(1200px, calc(100vw - var(--vp-sidebar-width) - 96px));
  }
}
@media (max-width: 640px) {
  .diagram-frame {
    height: 620px;
  }
}
</style>
