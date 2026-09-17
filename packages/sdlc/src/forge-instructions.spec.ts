import { checksumText } from '@neottia/distribution';
import { describe, expect, it } from 'vitest';

import type { SdlcCompilerContext, SdlcForgeConnectionContext } from './compiler-context.js';
import { createForgeInstructionPacks } from './forge-instructions.js';
import type { ForgeCapability, ForgeProvider } from './forge-support.js';

/** Creates one isolated selected-forge context for fragment tests. */
function context(provider: ForgeProvider, capabilities: readonly ForgeCapability[]): SdlcCompilerContext {
  const mcp = {
    issues: { server: `${provider}-issues`, command: `${provider}-mcp` },
    documents: { server: `${provider}-documents`, command: `${provider}-mcp` },
    remoteSourceControl: { server: `${provider}-remote`, command: `${provider}-mcp` },
  };
  const connection: SdlcForgeConnectionContext = {
    provider,
    capabilities,
    baseUrl: `https://${provider}.example.test/root/`,
    credentialEnvironment: `${provider.toUpperCase()}_TOKEN`,
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
    const github = createForgeInstructionPacks(context('github', ['issues', 'documents', 'remote-source-control']))
      .map(({ content }) => content)
      .join('\n');
    const gitlab = createForgeInstructionPacks(context('gitlab', ['issues', 'documents', 'remote-source-control']))
      .map(({ content }) => content)
      .join('\n');

    expect(github).toContain('`gh issue`');
    expect(github).toContain('`gh pr`, `gh run`, and `gh release`');
    expect(gitlab).toContain('`glab issue`');
    expect(gitlab).toContain('`glab mr`, `glab ci`, and `glab release`');
  });

  it('does not present administrative binaries as Gitea or Forgejo user clients', () => {
    for (const provider of ['gitea', 'forgejo'] as const) {
      const content = createForgeInstructionPacks(context(provider, ['issues', 'remote-source-control']))
        .map((pack) => pack.content)
        .join('\n');
      expect(content).toContain(`\`${provider}\` binary is an administrative server CLI`);
      expect(content).toContain(`configured MCP server is \`${provider}-issues\``);
      expect(content).not.toContain('`tea`');
    }
  });
});
