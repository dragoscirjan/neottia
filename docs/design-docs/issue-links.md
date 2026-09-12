# Design Docs issue links

Issues store `{kind: design-doc, id, version?}`. Omitting `version` follows the latest document version. Supplying it pins exact history. Archived versions remain resolvable.

Run `document_validate` with `cross_domain: true` to validate links against active and archived Issues. Both capability shards must be enabled. A disabled target, unresolved reference, malformed batch, or configured result-limit failure leaves canonical files unchanged.

Native hosts and MCP servers install `@neottia/issues-design-docs` by default. Direct embedders wire its two seams as shown in [Issues and Design Docs composition](/issues/design-docs). Design Docs itself does not import or mutate Issues.
