import { checksumText } from '@neottia/distribution';
import { describe, expect, it } from 'vitest';

import type { SdlcCompilerContext, SdlcForgeConnectionContext } from './compiler-context.js';
import { createForgeInstructionPacks } from './forge-instructions.js';
import type { ForgeCapability, ForgeProvider } from './forge-support.js';

/** Creates one isolated selected-forge context for fragment tests. */
function context(
  provider: ForgeProvider,
  capabilities: readonly ForgeCapability[],
  withMcp = true,
): SdlcCompilerContext {
  const mcp = withMcp
    ? {
        issues: { server: `${provider}-issues`, command: `${provider}-mcp` },
        documents: { server: `${provider}-documents`, command: `${provider}-mcp` },
        remoteSourceControl: { server: `${provider}-remote`, command: `${provider}-mcp` },
      }
    : {};
  const connection: SdlcForgeConnectionContext = {
    provider,
    capabilities,
    baseUrl: `https://${provider}.example.test/root/`,
    credentialEnvironment: `${provider.toUpperCase()}_TOKEN`,
    allowInsecureHttp: false,
    mcp,
  };
  return {
    issues: { provider: capabilities.includes('issues') ? provider : 'filesystem' },
    documents: { provider: capabilities.includes('documents') ? provider : 'filesystem' },
    sourceControl: {
      local: 'git',
      remote: capabilities.includes('remote-source-control') ? { enabled: true, provider } : { enabled: false },
      workspaces: false,
    },
    forges: [connection],
  };
}

describe('forge instruction bundles', () => {
  it.each([
    ['github', ['issues', 'documents', 'remote-source-control']],
    ['gitlab', ['issues', 'documents', 'remote-source-control']],
    ['gitea', ['issues', 'remote-source-control']],
    ['forgejo', ['issues', 'remote-source-control']],
    ['bitbucket', ['remote-source-control']],
    ['jira', ['issues']],
    ['confluence', ['documents']],
  ] as const)('creates checksummed selected fragments for %s', (provider, capabilities) => {
    const packs = createForgeInstructionPacks(context(provider, capabilities));

    expect(packs.map(({ slot }) => slot).sort()).toEqual(
      capabilities
        .map((capability) => (capability === 'remote-source-control' ? 'source-control.remote' : capability))
        .sort(),
    );
    expect(packs.every((pack) => pack.provider === provider)).toBe(true);
    for (const pack of packs) {
      expect(pack.checksum).toBe(checksumText(pack.content));
      expect(pack.content).toContain(`https://${provider}.example.test/root/`);
      expect(pack.content).toContain(`${provider.toUpperCase()}_TOKEN`);
      expect(pack.content).toContain('choose exactly one available tool');
      expect(pack.content).toContain('never retry the same mutation through another tool');
      expect(pack.content).toContain('separate explicit authorization');
    }
  });

  it('uses documented GitHub and GitLab command groups', () => {
    const github = createForgeInstructionPacks(
      context('github', ['issues', 'documents', 'remote-source-control'], false),
    )
      .map(({ content }) => content)
      .join('\n');
    const gitlab = createForgeInstructionPacks(
      context('gitlab', ['issues', 'documents', 'remote-source-control'], false),
    )
      .map(({ content }) => content)
      .join('\n');

    expect(github).toContain('`gh issue`');
    expect(github).toContain('`gh pr`, `gh run`, and `gh release`');
    expect(gitlab).toContain('`glab issue`');
    expect(gitlab).toContain('`glab mr`, `glab ci`, and `glab release`');
  });

  it('uses only configured MCP routes when they cover a capability', () => {
    const github = createForgeInstructionPacks(context('github', ['issues', 'documents', 'remote-source-control']));

    expect(github.find((pack) => pack.slot === 'issues')?.content).not.toContain('`gh issue`');
    expect(github.find((pack) => pack.slot === 'documents')?.content).not.toContain('local Git');
    expect(github.find((pack) => pack.slot === 'source-control.remote')?.content).not.toContain('`gh pr`');
    expect(github.every((pack) => pack.content.includes('only provider-object route'))).toBe(true);
  });

  it('preserves distinct Jira, Confluence, and Bitbucket semantics', () => {
    const jira = createForgeInstructionPacks(context('jira', ['issues']))[0]!.content;
    const confluence = createForgeInstructionPacks(context('confluence', ['documents']))[0]!.content;
    const bitbucket = createForgeInstructionPacks(context('bitbucket', ['remote-source-control']))[0]!.content;

    expect(jira).toContain('Jira work item search');
    expect(jira).toContain('field metadata and allowed transitions');
    expect(jira).not.toContain('Confluence');
    expect(confluence).toContain('current content, space, parent, and version');
    expect(confluence).toContain('Do not substitute repository files');
    expect(confluence).not.toContain('Jira work item');
    expect(bitbucket).toContain('Bitbucket pull requests');
    expect(bitbucket).toContain('pipeline and deployment evidence');
    expect(bitbucket).toContain('Require an explicit release operation');
    expect(bitbucket).toContain('Use local Git for fetch and push');
  });

  it('warns only when a selected connection opts into insecure HTTP', () => {
    const selected = context('gitlab', ['issues'], false);
    const insecure: SdlcCompilerContext = {
      ...selected,
      forges: selected.forges.map((connection) => ({
        ...connection,
        baseUrl: 'http://gitlab.example.test',
        allowInsecureHttp: true,
      })),
    };

    expect(createForgeInstructionPacks(insecure)[0]?.content).toContain('explicitly permits insecure HTTP');
    expect(createForgeInstructionPacks(selected)[0]?.content).not.toContain('insecure HTTP');
  });

  it('does not mention unused administrative binaries for Gitea or Forgejo', () => {
    for (const provider of ['gitea', 'forgejo'] as const) {
      const content = createForgeInstructionPacks(context(provider, ['issues', 'remote-source-control']))
        .map((pack) => pack.content)
        .join('\n');
      expect(content).toContain(`configured MCP server is \`${provider}-issues\``);
      expect(content).not.toContain(`\`${provider}\` binary`);
      expect(content).not.toContain('administrative server CLI');
      expect(content).not.toContain('`tea`');
    }
  });
});
