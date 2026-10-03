import { defineConfigContribution } from '@neottia/config';
import { z } from 'zod';

/** Issue authorities recognized by the compile-time configuration contract. */
export const ISSUE_PROVIDERS = Object.freeze(['filesystem', 'github', 'gitlab', 'gitea', 'forgejo', 'jira'] as const);
/** Document authorities recognized by the compile-time configuration contract. */
export const DOCUMENT_PROVIDERS = Object.freeze([
  'filesystem',
  'github',
  'gitlab',
  'gitea',
  'forgejo',
  'confluence',
] as const);
/** Local source-control implementations recognized by the compiler contract. */
export const LOCAL_SOURCE_CONTROL_PROVIDERS = Object.freeze(['git', 'jj'] as const);
/** Memory authorities recognized by the compile-time configuration contract; 'none' keeps Memory out of the lifecycle. */
export const MEMORY_PROVIDERS = Object.freeze(['none', 'filesystem', 'postgres'] as const);
/** Web-retrieval authorities recognized by the compile-time configuration contract; 'none' keeps Searchable out of the lifecycle. */
export const SEARCHABLE_PROVIDERS = Object.freeze(['none', 'web'] as const);
/** Remote forge selections reserved for the provider instruction packs. */
export const REMOTE_SOURCE_CONTROL_PROVIDERS = Object.freeze([
  'github',
  'gitlab',
  'gitea',
  'forgejo',
  'bitbucket',
] as const);

const issueProviderSchema = z.enum(ISSUE_PROVIDERS);
const documentProviderSchema = z.enum(DOCUMENT_PROVIDERS);
const localSourceControlSchema = z.enum(LOCAL_SOURCE_CONTROL_PROVIDERS);
const remoteSourceControlProviderSchema = z.enum(REMOTE_SOURCE_CONTROL_PROVIDERS);
const memoryProviderSchema = z.enum(MEMORY_PROVIDERS);
const searchableProviderSchema = z.enum(SEARCHABLE_PROVIDERS);

/** Complete strict Issues capability schema. */
export const issuesCapabilityConfigSchema = z.object({ provider: issueProviderSchema.default('filesystem') }).strict();
/** Default-free Issues capability schema used by each source layer. */
export const issuesCapabilityConfigPatchSchema = z.object({ provider: issueProviderSchema.optional() }).strict();

/** Complete strict Documents capability schema. */
export const documentsCapabilityConfigSchema = z
  .object({ provider: documentProviderSchema.default('filesystem') })
  .strict();
/** Default-free Documents capability schema used by each source layer. */
export const documentsCapabilityConfigPatchSchema = z.object({ provider: documentProviderSchema.optional() }).strict();

// The scalar union replaces atomically across layers, so a profile can disable a lower remote selection.
const remoteSourceControlSchema = z.union([z.literal(false), remoteSourceControlProviderSchema]);

/** Complete strict source-control capability schema. */
export const sourceControlCapabilityConfigSchema = z
  .object({
    local: localSourceControlSchema.default('git'),
    remote: remoteSourceControlSchema.default(false),
    workspaces: z.boolean().default(false),
  })
  .strict();
/** Default-free source-control capability schema used by each source layer. */
export const sourceControlCapabilityConfigPatchSchema = z
  .object({
    local: localSourceControlSchema.optional(),
    remote: remoteSourceControlSchema.optional(),
    workspaces: z.boolean().optional(),
  })
  .strict();

/** Complete strict Memory capability schema. */
export const memoryCapabilityConfigSchema = z.object({ provider: memoryProviderSchema.default('none') }).strict();
/** Default-free Memory capability schema used by each source layer. */
export const memoryCapabilityConfigPatchSchema = z.object({ provider: memoryProviderSchema.optional() }).strict();

/** Complete strict Searchable capability schema. */
export const searchableCapabilityConfigSchema = z
  .object({ provider: searchableProviderSchema.default('none') })
  .strict();
/** Default-free Searchable capability schema used by each source layer. */
export const searchableCapabilityConfigPatchSchema = z
  .object({ provider: searchableProviderSchema.optional() })
  .strict();

export type IssueProvider = z.output<typeof issueProviderSchema>;
export type DocumentProvider = z.output<typeof documentProviderSchema>;
export type LocalSourceControlProvider = z.output<typeof localSourceControlSchema>;
export type RemoteSourceControlProvider = z.output<typeof remoteSourceControlProviderSchema>;
export type MemoryProvider = z.output<typeof memoryProviderSchema>;
export type SearchableProvider = z.output<typeof searchableProviderSchema>;
export type IssuesCapabilityConfig = z.output<typeof issuesCapabilityConfigSchema>;
export type DocumentsCapabilityConfig = z.output<typeof documentsCapabilityConfigSchema>;
export type SourceControlCapabilityConfig = z.output<typeof sourceControlCapabilityConfigSchema>;
export type MemoryCapabilityConfig = z.output<typeof memoryCapabilityConfigSchema>;
export type SearchableCapabilityConfig = z.output<typeof searchableCapabilityConfigSchema>;

/** Complete lowest-precedence Issues capability value. */
const ISSUES_CAPABILITY_DEFAULTS: IssuesCapabilityConfig = issuesCapabilityConfigSchema.parse({});
/** Complete lowest-precedence Documents capability value. */
const DOCUMENTS_CAPABILITY_DEFAULTS: DocumentsCapabilityConfig = documentsCapabilityConfigSchema.parse({});
/** Complete lowest-precedence source-control capability value. */
const SOURCE_CONTROL_CAPABILITY_DEFAULTS: SourceControlCapabilityConfig = sourceControlCapabilityConfigSchema.parse({});
/** Complete lowest-precedence Memory capability value. */
const MEMORY_CAPABILITY_DEFAULTS: MemoryCapabilityConfig = memoryCapabilityConfigSchema.parse({});
/** Complete lowest-precedence Searchable capability value. */
const SEARCHABLE_CAPABILITY_DEFAULTS: SearchableCapabilityConfig = searchableCapabilityConfigSchema.parse({});

/** Issues provider selection contributed to the unified configuration. */
export const issuesCapabilityConfigContribution = defineConfigContribution({
  id: 'sdlc-issues-capability',
  path: ['capabilities', 'issues'],
  filePatchSchema: issuesCapabilityConfigPatchSchema,
  runtimePatchSchema: issuesCapabilityConfigPatchSchema,
  resolvedSchema: issuesCapabilityConfigSchema,
  defaults: ISSUES_CAPABILITY_DEFAULTS,
});

/** Documents provider selection contributed to the unified configuration. */
export const documentsCapabilityConfigContribution = defineConfigContribution({
  id: 'sdlc-documents-capability',
  path: ['capabilities', 'documents'],
  filePatchSchema: documentsCapabilityConfigPatchSchema,
  runtimePatchSchema: documentsCapabilityConfigPatchSchema,
  resolvedSchema: documentsCapabilityConfigSchema,
  defaults: DOCUMENTS_CAPABILITY_DEFAULTS,
});

/** Local and remote source-control selection contributed to unified configuration. */
export const sourceControlCapabilityConfigContribution = defineConfigContribution({
  id: 'sdlc-source-control-capability',
  path: ['capabilities', 'source_control'],
  filePatchSchema: sourceControlCapabilityConfigPatchSchema,
  runtimePatchSchema: sourceControlCapabilityConfigPatchSchema,
  resolvedSchema: sourceControlCapabilityConfigSchema,
  defaults: SOURCE_CONTROL_CAPABILITY_DEFAULTS,
});

/** Optional Memory lifecycle selection contributed to unified configuration; 'none' keeps Memory outside the lifecycle. */
export const memoryCapabilityConfigContribution = defineConfigContribution({
  id: 'sdlc-memory-capability',
  path: ['capabilities', 'memory'],
  filePatchSchema: memoryCapabilityConfigPatchSchema,
  runtimePatchSchema: memoryCapabilityConfigPatchSchema,
  resolvedSchema: memoryCapabilityConfigSchema,
  defaults: MEMORY_CAPABILITY_DEFAULTS,
});

/** Optional Searchable lifecycle selection contributed to unified configuration; 'none' keeps web retrieval outside the lifecycle. */
export const searchableCapabilityConfigContribution = defineConfigContribution({
  id: 'sdlc-searchable-capability',
  path: ['capabilities', 'searchable'],
  filePatchSchema: searchableCapabilityConfigPatchSchema,
  runtimePatchSchema: searchableCapabilityConfigPatchSchema,
  resolvedSchema: searchableCapabilityConfigSchema,
  defaults: SEARCHABLE_CAPABILITY_DEFAULTS,
});
