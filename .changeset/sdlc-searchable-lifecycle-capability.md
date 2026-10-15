---
"@neottia/sdlc": minor
"@neottia/cli": minor
"@neottia/config-registry": minor
---

Integrate Searchable as an optional SDLC lifecycle capability (#182). The compiler gains a `capabilities.searchable` contribution (`none` | `web`, default `none`) with fail-closed semantics: a `web` selection requires `modules.searchable.enabled`, and the published configuration schema covers the new shard. When enabled, every compiled lifecycle command renders web-retrieval boundaries — search and fetch stay bounded to the enabled capability, every cited page is recorded as a canonical stash through `web_stash`, and local Ollama enrichment runs only where the searchable configuration enables it; web retrieval never authorizes mutation, acquires credentials, contacts undeclared hosts, or bypasses the issue and document authorities. The compiler also now requires the Memory and Searchable boundary fragments to render exactly once in every command so template overrides cannot silently drop them. The CLI initializer accepts `--enable searchable` alongside `--enable memory`, keeping both capabilities disabled by default.
