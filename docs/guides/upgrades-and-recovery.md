# Upgrades and recovery

After an upgrade, validate each enabled domain. Confirm canonical counts, inspect errors, and rebuild disposable caches only after canonical validation succeeds.

For a stale revision, fetch current state, compare the competing change, and retry with the new revision. For lease contention, inspect the current owner evidence and wait for the owner to exit. Do not delete a live lease.

For a corrupt or incompatible cache, remove the domain DB, WAL, and SHM files or choose the documented rebuild path. Canonical files recreate it. Under `stale_policy: fail`, run the domain validation tool to make the rebuild explicit.

Repository Store recovers authenticated journals while acquiring a lease. If recovery fails closed, preserve the transaction directory and reported evidence before manual changes. A modified or ambiguous journal needs operator review.

Treat unsupported runtime or filesystem errors as deployment constraints. Move the operation to a supported Linux runtime and local filesystem; do not rewrite canonical data.
