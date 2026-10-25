---
aside: false
---

<script setup>
import { withBase } from 'vitepress'

const diagram = withBase('/diagrams/neottia-runtime.html')
</script>

# Runtime and repository data flow

Pi and OpenCode normally load native extension packages. Claude Code and other MCP clients launch stdio servers. Both routes reach the same Memory, Issues, Design Docs, and Searchable domain tools.

<div class="diagram-links">
  <a :href="diagram" target="_blank" rel="noreferrer">Open the interactive data-flow diagram in a new tab</a>
</div>

<div class="diagram-frame blueprint">
  <iframe :src="diagram" title="Interactive Neottia runtime and repository data-flow diagram" loading="lazy"></iframe>
</div>

## Two runtime routes

- **Native extension route** — Pi or OpenCode loads a Neottia package in process and calls the domain library directly.
- **Generic MCP route** — Claude Code or another compatible client launches a stdio server, which validates the MCP request and calls the same domain library.

Do not enable both routes for the same capability in one host. Duplicate registrations can make ownership and cleanup ambiguous.

## One write authority

Domain packages do not publish repository files with ad hoc writes. Repository Store provides:

- path confinement and ancestor revalidation;
- leases and exact identity checks;
- no-replace publication;
- preconditions and revision checks;
- transaction journals and crash recovery;
- file and namespace durability barriers.

Unsupported runtimes and filesystems fail closed. Use [Doctor](/operate/doctor) in the actual project directory before relying on filesystem-backed capabilities.

## Canonical and disposable state

Track canonical records:

- `.neottia/memory/...` YAML records;
- `.neottia/issues/...` YAML issue files;
- `.neottia/design-docs/...` Markdown documents;
- `.neottia/searchable/pages/...` JSON page stashes.

Ignore disposable state:

- Memory `index.db*` files;
- `.neottia/cache/` SQLite projections;
- `.neottia/repository-store/` leases, journals, and recovery control files.

See [Repository files and Git](/guides/repository-files) for exact ignore rules. See [diagram sources and attribution](/reference/diagrams) for evidence and license details.

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
  background: #03131e;
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
