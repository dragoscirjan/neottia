export {
  memoryTypeSchema,
  recordTypeSchema,
  sourceKindSchema,
  confidenceSchema,
  memoryRecordSchema,
  memoryTombstoneSchema,
  memoryDocumentSchema,
  type MemoryType,
  type RecordType,
  type SourceKind,
  type Confidence,
  type MemorySource,
  type MemoryRecord,
  type MemoryTombstone,
} from './schemas.js';

export { ConfigError, MemoryConflictError, MemoryError, MemoryLockError, formatSchemaError } from './errors.js';
export { MemoryConfigPatternError, MemorySecretError } from './security.js';

export {
  CONFIG_FILE_ENV,
  DEFAULT_CONFIG_FILE,
  DEFAULT_SHARD_PATH,
  MEMORY_CONFIG_FILE_ENV,
  MEMORY_ENV_BINDINGS,
  MEMORY_SHARD_PATH_ENV,
  CREDENTIAL_DEFAULTS,
  loadMemoryConfig,
  memoryConfigSchema,
  resolveConfigFile,
  resolveShardPath,
  type LoadMemoryConfigOptions,
  type MemoryConfig,
  type MemoryConfigInput,
} from './config.js';

export { createUlid, isUlid, ULID_PATTERN } from './identities.js';
export { createSecretScanner, looksHighEntropy, scannerOptionsFromConfig } from './security.js';
export { withShardBarrier } from './barrier.js';
export { SqliteIndex, canonicalHash } from './index-sqlite.js';
export { FilesystemBackend, RECORD_FOLDERS } from './backend/filesystem.js';
export { PostgresBackend, resolvePgSettings, type PgConnectionSettings } from './backend/postgres.js';
export type { NamespaceScope, ShardState, StorageBackend, StorageLimits, StorageReplacement } from './backend/types.js';
export { MemoryStore } from './store.js';
export type {
  ImportReport,
  MemoryStoreOptions,
  MemoryValidationReport,
  SearchMemoryInput,
  StoreMemoryInput,
} from './store.js';
export {
  MEMORY_TOOLS,
  findMemoryTool,
  deleteInputSchema,
  exportInputSchema,
  getInputSchema,
  importInputSchema,
  listInputSchema,
  searchInputSchema,
  storeInputSchema,
  supersedeInputSchema,
  validateInputSchema,
} from './tools.js';
export type { MemoryToolContext, MemoryToolDefinition } from './tools.js';
