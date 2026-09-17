import { describe, expect, it } from 'vitest';

import {
  forgeConnectionsConfigPatchSchema,
  forgeConnectionsConfigSchema,
  forgeMcpConfigSchema,
  forgeMcpServiceSchema,
} from './forge-config.js';
import { FORGE_SUPPORT_DECLARATIONS } from './forge-support.js';

const githubConnection = {
  base_url: 'https://github.example.test/engineering/',
  credential_environment: 'GITHUB_TOKEN',
  mcp: {
    issues: { server: 'github', command: 'github-mcp-server' },
  },
};

describe('forge connection configuration', () => {
  it('accepts strict self-hosted connections and remains default-free', () => {
    expect(forgeConnectionsConfigSchema.parse({})).toEqual({});
    expect(forgeConnectionsConfigPatchSchema.parse({ github: githubConnection })).toEqual({
      github: githubConnection,
    });
    expect(forgeConnectionsConfigPatchSchema.parse({})).toEqual({});
    expect(
      forgeConnectionsConfigPatchSchema.parse({
        github: { base_url: 'https://github.enterprise.test' },
      }),
    ).toEqual({ github: { base_url: 'https://github.enterprise.test' } });
    expect(
      forgeConnectionsConfigSchema.safeParse({
        github: { base_url: 'https://github.enterprise.test' },
      }).success,
    ).toBe(false);
  });

  it.each([
    'ssh://github.example.test',
    'https://user@github.example.test',
    'https://github.example.test?token=secret',
    'https://github.example.test#fragment',
    `https://github.example.test/${'é'.repeat(4_100)}`,
    '',
  ])('rejects unsafe, oversized, or malformed base URL %s', (baseUrl) => {
    expect(
      forgeConnectionsConfigSchema.safeParse({
        github: { ...githubConnection, base_url: baseUrl },
      }).success,
    ).toBe(false);
  });

  it.each(['${GITHUB_TOKEN}', 'token-name', '1TOKEN', 'TOKEN VALUE', ''])(
    'rejects invalid credential environment name %s',
    (credentialEnvironment) => {
      expect(
        forgeConnectionsConfigSchema.safeParse({
          github: { ...githubConnection, credential_environment: credentialEnvironment },
        }).success,
      ).toBe(false);
    },
  );

  it('rejects partial or conflicting MCP declarations, arguments, and unknown provider keys', () => {
    expect(forgeMcpServiceSchema.safeParse({ server: 'github' }).success).toBe(false);
    expect(forgeMcpServiceSchema.safeParse({ server: 'github', command: 'node server.js' }).success).toBe(false);
    expect(
      forgeMcpConfigSchema.safeParse({
        issues: { server: 'github', command: 'github-mcp-issues' },
        remote_source_control: { server: 'github', command: 'github-mcp-remote' },
      }).success,
    ).toBe(false);
    expect(
      forgeConnectionsConfigSchema.safeParse({
        github: { ...githubConnection, unknown: true },
      }).success,
    ).toBe(false);
    expect(forgeConnectionsConfigSchema.safeParse({ azure_devops: githubConnection }).success).toBe(false);
  });

  it('accepts independent Atlassian product connections and rejects unrelated MCP slots', () => {
    const service = { server: 'atlassian', command: 'mcp-remote' };
    const connections = {
      bitbucket: {
        base_url: 'https://bitbucket.org/example',
        credential_environment: 'BITBUCKET_TOKEN',
        mcp: { remote_source_control: service },
      },
      jira: {
        base_url: 'https://example.atlassian.net',
        credential_environment: 'JIRA_TOKEN',
        mcp: { issues: service },
      },
      confluence: {
        base_url: 'https://example.atlassian.net/wiki',
        credential_environment: 'CONFLUENCE_TOKEN',
        mcp: { documents: service },
      },
    };

    expect(forgeConnectionsConfigSchema.parse(connections)).toEqual(connections);
    expect(
      forgeConnectionsConfigSchema.safeParse({
        jira: { ...connections.jira, mcp: { documents: service } },
      }).success,
    ).toBe(false);
    expect(
      forgeConnectionsConfigSchema.safeParse({
        confluence: { ...connections.confluence, mcp: { issues: service } },
      }).success,
    ).toBe(false);
    expect(
      forgeConnectionsConfigSchema.safeParse({
        bitbucket: { ...connections.bitbucket, mcp: { issues: service } },
      }).success,
    ).toBe(false);
  });
});

describe('forge support declarations', () => {
  it('declares documented CLI and MCP support without assuming provider parity', () => {
    expect(FORGE_SUPPORT_DECLARATIONS.github.cli?.command).toBe('gh');
    expect(FORGE_SUPPORT_DECLARATIONS.gitlab.cli?.command).toBe('glab');
    for (const provider of ['gitea', 'forgejo', 'bitbucket', 'jira', 'confluence'] as const) {
      expect(FORGE_SUPPORT_DECLARATIONS[provider].cli).toBeUndefined();
    }
    expect(FORGE_SUPPORT_DECLARATIONS.gitea.capabilities).not.toContain('documents');
    expect(FORGE_SUPPORT_DECLARATIONS.forgejo.capabilities).not.toContain('documents');
    expect(FORGE_SUPPORT_DECLARATIONS.gitea.mcpRequiredFor).toEqual(['issues', 'remote-source-control']);
    expect(FORGE_SUPPORT_DECLARATIONS.forgejo.mcpRequiredFor).toEqual(['issues', 'remote-source-control']);
    expect(FORGE_SUPPORT_DECLARATIONS.bitbucket.capabilities).toEqual(['remote-source-control']);
    expect(FORGE_SUPPORT_DECLARATIONS.jira.capabilities).toEqual(['issues']);
    expect(FORGE_SUPPORT_DECLARATIONS.confluence.capabilities).toEqual(['documents']);
    expect(FORGE_SUPPORT_DECLARATIONS.bitbucket.mcpRequiredFor).toEqual(['remote-source-control']);
    expect(FORGE_SUPPORT_DECLARATIONS.jira.mcpRequiredFor).toEqual(['issues']);
    expect(FORGE_SUPPORT_DECLARATIONS.confluence.mcpRequiredFor).toEqual(['documents']);
    expect(FORGE_SUPPORT_DECLARATIONS.jira.documentation.mcp).toContain('atlassian-rovo-mcp-server');
  });
});
