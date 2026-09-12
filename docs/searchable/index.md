# Searchable foundation

> Searchable is foundation-only. It does not include provider clients, fetch extraction, persistence, Ollama calls, MCP, Pi, or OpenCode integration. Your application must provide all five services.

Install `@neottia/searchable-core` only when writing a TypeScript embedder. The package supplies strict inputs and outputs, configuration loading, service types, byte and result limits, cancellation checks, and redacted errors.

- [Configure caller-owned defaults](/searchable/configuration)
- [Implement every service](/searchable/services)
- [Call the five contracts](/searchable/tools)
- [Apply security responsibilities](/searchable/security)

Provider and strategy names in configuration are values passed to your services. They do not cause network, extraction, storage, or model operations. There is no first-success host setup, MCP package, or native extension.
