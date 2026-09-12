# @neottia/pi-design-docs

Pi extension exposing all Design Docs tools in process. It routes each call to the active tool-context worktree, forwards cancellation, and installs real Issues link validation for `document_validate(cross_domain: true)`.

Pi may ask before review/approval transitions; the canonical transition input still records caller-provided intent/evidence. With `cache.stale_policy: prompt`, Pi calls `ui.confirm` before replacing a stale search cache. Acceptance rebuilds it, while decline returns `CACHE_STALE_DECLINED` and preserves the existing cache. If no UI is available, the extension rebuilds. Embedders can override this behavior with `registerDesignDocsTools(pi, {onStaleCache})` and can inject a custom `linkValidator`.
