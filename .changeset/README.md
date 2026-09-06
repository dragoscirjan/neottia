# Changesets

This project uses [Changesets](https://github.com/changesets/changesets) to version and release workspace modules independently.

Workflow:

```bash
mise run changeset          # describe the change (patch/minor/major + summary)
mise run version:modules     # apply pending changesets to module versions
mise run release:modules     # publish affected modules
mise run release:global -- X.Y.Z  # pin a global Neottia release BOM
```

Notes:

- `@neottia/release` is ignored by Changesets; it is prepared by `mise run release:global`.
- A changeset file is only needed when a published module's behavior changes.
