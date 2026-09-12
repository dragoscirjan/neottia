# Security and errors

Issues, Design Docs, and Repository Store use structured errors with a category, stable code, message, retryability, and bounded details or paths. Searchable errors contain `category`, `code`, `message`, `paths`, and optional `details`; they do not expose a retryability field. Branch on the code and avoid logging rejected secrets. Memory library errors are typed, but current Memory MCP errors are plain text.

A secret rejection means Memory detected a configured pattern or high-entropy candidate. Remove the secret and store only a reference to the protected credential. Resource-limit errors name the configured boundary; narrow the request or review the configuration rather than bypassing validation.

Path errors reject traversal, symlinks, unsafe components, and authority conflicts. Contention errors require waiting or inspecting owner evidence. Stale revisions require a fresh read. Stale or corrupt cache errors permit rebuilding only from valid canonical data. Unsupported platform errors require a supported deployment.

See [Memory operations](/memory/operations), [Issues operations](/issues/operations), [Design Docs operations](/design-docs/operations), [Searchable security](/searchable/security), and [Repository Store](/repository-store).
