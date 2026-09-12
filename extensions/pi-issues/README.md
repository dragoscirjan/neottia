# @neottia/pi-issues

Pi extension exposing the seventeen canonical Neottia issue tools in-process. Add the package to Pi's extension configuration and enable `skills.issues` in `.neottia/config.yml`. Calls use the active invocation project, generated core schemas, Pi cancellation, and Pi confirmation for `prompt` cache policy. When both capabilities are enabled, the extension validates typed design-document links through its default `@neottia/issues-design-docs` resolver. `registerIssueTools` accepts resolver and stale-cache callback overrides.
