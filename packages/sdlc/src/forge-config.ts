import { defineConfigContribution } from '@neottia/config';
import { z } from 'zod';

const HTTP_URL_PATTERN = /^[hH][tT][tT][pP][sS]?:\/\/(?![^/?#]*@)[^?#]+$/u;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const STABLE_SERVER_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** Strict self-hosted forge URL without embedded credentials or secret-bearing suffixes. */
export const forgeBaseUrlSchema = z
  .url()
  .regex(HTTP_URL_PATTERN, 'must use HTTP(S) without user information, a query, or a fragment')
  .max(8 * 1024)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 8 * 1024, 'must not exceed 8 KiB as UTF-8')
  .meta({ format: 'uri' });

/** Name of an environment variable that supplies provider credentials at runtime. */
export const forgeCredentialEnvironmentSchema = z.string().regex(ENVIRONMENT_NAME_PATTERN).max(128);

/** Command-backed MCP service selected for one provider capability. */
export const forgeMcpServiceSchema = z
  .object({
    server: z.string().regex(STABLE_SERVER_ID_PATTERN).max(128),
    command: z.string().regex(COMMAND_NAME_PATTERN).max(128),
  })
  .strict();

/** Optional MCP services assigned independently to stable provider slots. */
export const forgeMcpConfigSchema = z
  .object({
    issues: forgeMcpServiceSchema.optional(),
    documents: forgeMcpServiceSchema.optional(),
    remote_source_control: forgeMcpServiceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const commands = new Map<string, string>();
    for (const [capability, service] of [
      ['issues', value.issues],
      ['documents', value.documents],
      ['remote_source_control', value.remote_source_control],
    ] as const) {
      if (service === undefined) continue;
      const command = commands.get(service.server);
      if (command !== undefined && command !== service.command) {
        context.addIssue({
          code: 'custom',
          path: [capability, 'command'],
          message: 'must match the command assigned to the same MCP server identifier',
        });
      } else {
        commands.set(service.server, service.command);
      }
    }
  });

// Atlassian product connections accept only their independently selected capability slot.
const bitbucketMcpConfigSchema = z.object({ remote_source_control: forgeMcpServiceSchema.optional() }).strict();
const jiraMcpConfigSchema = z.object({ issues: forgeMcpServiceSchema.optional() }).strict();
const confluenceMcpConfigSchema = z.object({ documents: forgeMcpServiceSchema.optional() }).strict();

/** One complete forge connection referenced by compile-time capability selection. */
export const forgeConnectionSchema = z
  .object({
    base_url: forgeBaseUrlSchema,
    credential_environment: forgeCredentialEnvironmentSchema,
    allow_insecure_http: z.literal(true).optional(),
    mcp: forgeMcpConfigSchema.optional(),
  })
  .strict();

/** Default-free connection patch merged across file, profile, and runtime layers. */
export const forgeConnectionPatchSchema = z
  .object({
    base_url: forgeBaseUrlSchema.optional(),
    credential_environment: forgeCredentialEnvironmentSchema.optional(),
    allow_insecure_http: z.literal(true).optional(),
    mcp: forgeMcpConfigSchema.optional(),
  })
  .strict();

// These variants preserve the common connection contract while rejecting unrelated MCP slots.
const bitbucketConnectionSchema = forgeConnectionSchema.extend({ mcp: bitbucketMcpConfigSchema.optional() }).strict();
const jiraConnectionSchema = forgeConnectionSchema.extend({ mcp: jiraMcpConfigSchema.optional() }).strict();
const confluenceConnectionSchema = forgeConnectionSchema.extend({ mcp: confluenceMcpConfigSchema.optional() }).strict();
const bitbucketConnectionPatchSchema = forgeConnectionPatchSchema
  .extend({ mcp: bitbucketMcpConfigSchema.optional() })
  .strict();
const jiraConnectionPatchSchema = forgeConnectionPatchSchema.extend({ mcp: jiraMcpConfigSchema.optional() }).strict();
const confluenceConnectionPatchSchema = forgeConnectionPatchSchema
  .extend({ mcp: confluenceMcpConfigSchema.optional() })
  .strict();

/** Complete strict connection map for the seven built-in provider bundles. */
export const forgeConnectionsConfigSchema = z
  .object({
    github: forgeConnectionSchema.optional(),
    gitlab: forgeConnectionSchema.optional(),
    gitea: forgeConnectionSchema.optional(),
    forgejo: forgeConnectionSchema.optional(),
    bitbucket: bitbucketConnectionSchema.optional(),
    jira: jiraConnectionSchema.optional(),
    confluence: confluenceConnectionSchema.optional(),
  })
  .strict();

/** Default-free connection map patch used by every source layer. */
export const forgeConnectionsConfigPatchSchema = z
  .object({
    github: forgeConnectionPatchSchema.optional(),
    gitlab: forgeConnectionPatchSchema.optional(),
    gitea: forgeConnectionPatchSchema.optional(),
    forgejo: forgeConnectionPatchSchema.optional(),
    bitbucket: bitbucketConnectionPatchSchema.optional(),
    jira: jiraConnectionPatchSchema.optional(),
    confluence: confluenceConnectionPatchSchema.optional(),
  })
  .strict();

export type ForgeMcpService = z.output<typeof forgeMcpServiceSchema>;
export type ForgeMcpConfig = z.output<typeof forgeMcpConfigSchema>;
export type ForgeConnection = z.output<typeof forgeConnectionSchema>;
export type ForgeConnectionsConfig = z.output<typeof forgeConnectionsConfigSchema>;

/** Empty lowest-precedence map; selected providers require explicit connection details. */
const FORGE_CONNECTION_DEFAULTS: ForgeConnectionsConfig = forgeConnectionsConfigSchema.parse({});

/** Provider connections shared by Issues, Documents, and remote source-control selection. */
export const forgeConnectionsConfigContribution = defineConfigContribution({
  id: 'sdlc-forge-connections',
  path: ['connections', 'forges'],
  filePatchSchema: forgeConnectionsConfigPatchSchema,
  runtimePatchSchema: forgeConnectionsConfigPatchSchema,
  resolvedSchema: forgeConnectionsConfigSchema,
  defaults: FORGE_CONNECTION_DEFAULTS,
});
