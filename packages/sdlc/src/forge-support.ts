/** External providers delivered by the built-in SDLC instruction bundles. */
export const FORGE_PROVIDERS = Object.freeze([
  'github',
  'gitlab',
  'gitea',
  'forgejo',
  'bitbucket',
  'jira',
  'confluence',
] as const);

/** Provider capabilities that map to the stable SDLC instruction slots. */
export const FORGE_CAPABILITIES = Object.freeze(['issues', 'documents', 'remote-source-control'] as const);

/** Forge provider delivered by the built-in instruction bundles. */
export type ForgeProvider = (typeof FORGE_PROVIDERS)[number];
/** Provider capability declared before instruction selection. */
export type ForgeCapability = (typeof FORGE_CAPABILITIES)[number];

/** One documented command-line implementation used by a provider bundle. */
export interface ForgeCliSupport {
  readonly command: 'gh' | 'glab';
  readonly documentation: string;
}

/** Immutable compile-time support declaration for one forge. */
export interface ForgeSupportDeclaration {
  readonly provider: ForgeProvider;
  readonly capabilities: readonly ForgeCapability[];
  readonly cli?: ForgeCliSupport;
  readonly mcpRequiredFor: readonly ForgeCapability[];
  readonly documentation: Readonly<{
    readonly provider: string;
    readonly wiki?: string;
    readonly mcp?: string;
  }>;
}

/** Evidence-backed support matrix for the built-in forge bundles. */
export const FORGE_SUPPORT_DECLARATIONS: Readonly<Record<ForgeProvider, ForgeSupportDeclaration>> = Object.freeze({
  github: Object.freeze({
    provider: 'github',
    capabilities: Object.freeze(['issues', 'documents', 'remote-source-control'] as const),
    cli: Object.freeze({ command: 'gh', documentation: 'https://cli.github.com/manual/' }),
    mcpRequiredFor: Object.freeze([] as const),
    documentation: Object.freeze({
      provider: 'https://docs.github.com/',
      wiki: 'https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages',
    }),
  }),
  gitlab: Object.freeze({
    provider: 'gitlab',
    capabilities: Object.freeze(['issues', 'documents', 'remote-source-control'] as const),
    cli: Object.freeze({ command: 'glab', documentation: 'https://docs.gitlab.com/cli/' }),
    mcpRequiredFor: Object.freeze([] as const),
    documentation: Object.freeze({
      provider: 'https://docs.gitlab.com/',
      wiki: 'https://docs.gitlab.com/user/project/wiki/',
    }),
  }),
  gitea: Object.freeze({
    provider: 'gitea',
    capabilities: Object.freeze(['issues', 'remote-source-control'] as const),
    mcpRequiredFor: Object.freeze(['issues', 'remote-source-control'] as const),
    documentation: Object.freeze({ provider: 'https://docs.gitea.com/' }),
  }),
  forgejo: Object.freeze({
    provider: 'forgejo',
    capabilities: Object.freeze(['issues', 'remote-source-control'] as const),
    mcpRequiredFor: Object.freeze(['issues', 'remote-source-control'] as const),
    documentation: Object.freeze({ provider: 'https://forgejo.org/docs/latest/' }),
  }),
  bitbucket: Object.freeze({
    provider: 'bitbucket',
    capabilities: Object.freeze(['remote-source-control'] as const),
    mcpRequiredFor: Object.freeze(['remote-source-control'] as const),
    documentation: Object.freeze({
      provider: 'https://support.atlassian.com/bitbucket-cloud/',
      mcp: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/',
    }),
  }),
  jira: Object.freeze({
    provider: 'jira',
    capabilities: Object.freeze(['issues'] as const),
    mcpRequiredFor: Object.freeze(['issues'] as const),
    documentation: Object.freeze({
      provider: 'https://support.atlassian.com/jira-software-cloud/',
      mcp: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/',
    }),
  }),
  confluence: Object.freeze({
    provider: 'confluence',
    capabilities: Object.freeze(['documents'] as const),
    mcpRequiredFor: Object.freeze(['documents'] as const),
    documentation: Object.freeze({
      provider: 'https://support.atlassian.com/confluence-cloud/',
      mcp: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/',
    }),
  }),
});

/** Identifies provider names delivered by built-in instruction bundles without widening reserved enums. */
export function isForgeProvider(value: string): value is ForgeProvider {
  return FORGE_PROVIDERS.some((provider) => provider === value);
}
