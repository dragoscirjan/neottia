# Backup and migration

Domain export is a validated portable representation. Raw canonical files are the Git authority for filesystem backends. Keep both when migration risk warrants it.

For Memory, export JSONL, call import with `preview: true`, inspect the report, then call with `preview: false`. For Issues and Design Docs, import previews by default, but pass `preview: true` explicitly in procedures. Resolve conflicts before committing.

Issues and Design Docs accept their documented legacy harnessctl formats and report path mappings. They never scan legacy directories automatically. Keep source data until target validation passes.

Do not back up SQLite DB, WAL, or SHM files as authority. Do not copy `.neottia/repository-store/` as application data. Rebuild these from valid canonical records. PostgreSQL Memory backup and restore are database operations; preserve namespace ownership and verify the restored scope.

After migration, run `memory_validate`, `issue_validate`, and `document_validate`, then inspect canonical counts and sample IDs.
