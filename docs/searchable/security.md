# Searchable foundation security

> Searchable is foundation-only. The caller owns network and storage security.

Core checks cancellation before and after a service call. It validates tool inputs, validates returned objects, and enforces configured UTF-8 field limits, result counts, and serialized-output bytes. Errors pass through redaction so rejected URLs lose credentials, query strings, and fragments, and rejected values are not copied into limit messages.

The service must still enforce DNS and redirect policy, block private-network SSRF when required, stop streaming at the configured byte limit, apply request deadlines, limit persistent storage, isolate owners, and clean up resources. Core cannot enforce these inside caller-owned I/O.

Stable errors contain `category`, `code`, `message`, `paths`, and optional `details`. Codes include `TOOL_INPUT_INVALID`, `TOOL_OUTPUT_INVALID`, `RESOURCE_LIMIT_EXCEEDED`, and `OPERATION_CANCELLED`. There is no `retryable` field. Catch the error, log only redacted fields, and define retry policy in the embedding application.
