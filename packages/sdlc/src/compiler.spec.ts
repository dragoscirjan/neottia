import { createConfigRegistry, createResolvedConfigSnapshot, type ConfigShardValues } from '@neottia/config';
import { designDocsConfigContribution } from '@neottia/design-docs';
import { canonicalJson, checksumText, runDoctor, type FileAsset, type HostConfigAsset } from '@neottia/distribution';
import { issueConfigContribution } from '@neottia/issues';
import { describe, expect, it } from 'vitest';

import {
  compileSdlc,
  createSdlcCompilerInput as createRawSdlcCompilerInput,
  SdlcCompilerError,
  type CreateSdlcCompilerInputOptions,
  type SdlcCompilerInputManifest,
} from './compiler.js';
import {
  documentsCapabilityConfigContribution,
  issuesCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
} from './config.js';
import { forgeConnectionsConfigContribution } from './forge-config.js';
import { BUILTIN_SDLC_INSTRUCTION_PACKS, createSdlcInstructionPack } from './instructions.js';
import { SDLC_COMMAND_IDS, SDLC_LIFECYCLE } from './lifecycle.js';
import { sdlcRoleAssignmentsConfigContribution } from './role-config.js';
import { loadPackagedSdlcTemplateLayer } from './template-loader.js';

import { claudeCodeHarnessAdapter } from '../../../extensions/claude-code-adapter/src/index.js';
import { opencodeHarnessAdapter } from '../../../extensions/opencode-adapter/src/index.js';
import { piHarnessAdapter } from '../../../extensions/pi-adapter/src/index.js';

const registry = createConfigRegistry([
  issueConfigContribution,
  designDocsConfigContribution,
  forgeConnectionsConfigContribution,
  sdlcRoleAssignmentsConfigContribution,
  issuesCapabilityConfigContribution,
  documentsCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
]);
const runtimePackages = [
  { logicalId: 'issues' as const, version: '0.1.0' },
  { logicalId: 'design-docs' as const, version: '0.1.0' },
];
const REQUIRED_CURRENT_ASSIGNMENTS = Object.freeze({
  planner: { agent: 'current' as const },
  implementer: { agent: 'current' as const },
  verifier: { agent: 'current' as const },
  'release-coordinator': { agent: 'current' as const },
});
const packagedTemplateLayer = await loadPackagedSdlcTemplateLayer();

type TestCompilerInputOptions = Omit<CreateSdlcCompilerInputOptions, 'harnessDeclaration' | 'templateLayers'> & {
  readonly templateLayers?: CreateSdlcCompilerInputOptions['templateLayers'];
};

/** Adds the external packaged templates to one pure compiler invocation. */
function createSdlcCompilerInput(
  resolvedSnapshot: Parameters<typeof createRawSdlcCompilerInput>[0],
  options: TestCompilerInputOptions,
): SdlcCompilerInputManifest {
  const adapter =
    options.harnessId === 'pi'
      ? piHarnessAdapter
      : options.harnessId === 'opencode'
        ? opencodeHarnessAdapter
        : claudeCodeHarnessAdapter;
  return createRawSdlcCompilerInput(resolvedSnapshot, {
    ...options,
    harnessDeclaration: adapter.declaration,
    templateLayers: [packagedTemplateLayer, ...(options.templateLayers ?? [])],
  });
}

/** Creates a complete compiler snapshot without reading ambient configuration. */
function snapshot(values: ConfigShardValues = {}) {
  return createResolvedConfigSnapshot(registry, {
    issues: { enabled: true },
    'design-docs': { enabled: true },
    'sdlc-role-assignments': {
      pi: REQUIRED_CURRENT_ASSIGNMENTS,
      opencode: REQUIRED_CURRENT_ASSIGNMENTS,
      'claude-code': REQUIRED_CURRENT_ASSIGNMENTS,
    },
    ...values,
  });
}

/** Returns projected prompt assets in command ID order. */
function promptAssets(output: ReturnType<typeof compileSdlc>): readonly FileAsset[] {
  return output.assets.assets
    .filter((asset): asset is FileAsset => asset.kind === 'file')
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Removes adapter-owned frontmatter while retaining the canonical body. */
function promptBody(asset: FileAsset): string {
  return asset.content.replace(/^---\n[\s\S]*?\n---\n/u, '');
}

/** Recomputes the outer checksum for one adversarial decoded-input fixture. */
function resignCompilerInput(
  input: SdlcCompilerInputManifest,
  changes: Partial<SdlcCompilerInputManifest>,
): SdlcCompilerInputManifest {
  const candidate = structuredClone({ ...input, ...changes });
  const unsigned = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'checksum')) as Omit<
    SdlcCompilerInputManifest,
    'checksum'
  >;
  return { ...unsigned, checksum: checksumText(canonicalJson(unsigned)) };
}

describe('canonical SDLC compiler', () => {
  it('publishes six provider-neutral lifecycle commands', () => {
    expect(SDLC_COMMAND_IDS).toEqual(['plan', 'build', 'verify', 'release', 'continue', 'refresh']);
    expect(SDLC_LIFECYCLE).toHaveLength(6);
    const lifecycleContent = JSON.parse(
      packagedTemplateLayer.files.find((template) => template.id === 'neottia.sdlc.lifecycle')!.content,
    ) as {
      readonly commands: ReadonlyArray<{
        readonly id: string;
        readonly approvalPoints: readonly string[];
        readonly stopConditions: readonly string[];
      }>;
    };
    expect(lifecycleContent.commands.map((command) => command.id)).toEqual(SDLC_COMMAND_IDS);
    expect(new Set(lifecycleContent.commands.flatMap((command) => command.approvalPoints)).size).toBeGreaterThan(3);
    expect(lifecycleContent.commands.every((command) => command.stopConditions.length > 0)).toBe(true);
    expect(SDLC_LIFECYCLE.find((command) => command.id === 'plan')?.roleSlots).toEqual(['planner', 'researcher']);
    for (const template of packagedTemplateLayer.files) {
      expect(template.content).not.toMatch(/\b(?:github|gitlab|bitbucket|jira|confluence|filesystem)\b/iu);
      expect(template.content).not.toMatch(/`(?:issue_|document_|git\b)/u);
    }
  });

  it('compiles equivalent Pi and OpenCode semantics with host-owned paths', () => {
    const piInput = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
      runtimePackages,
    });
    const opencodeInput = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'opencode',
      scope: 'project',
      runtimePackages,
    });
    const pi = compileSdlc(piInput, piHarnessAdapter);
    const opencode = compileSdlc(opencodeInput, opencodeHarnessAdapter);

    expect(pi.commands.find((command) => command.id === 'plan')?.approvalPoints).toEqual([
      'Obtain explicit approval for the proposed scope before Build.',
    ]);
    expect(promptBody(promptAssets(pi).find((asset) => asset.target.segments.at(-1) === 'plan.md')!)).toContain(
      'Obtain explicit approval for the proposed scope before Build.',
    );
    expect(pi.commands.map((command) => ({ ...command, target: undefined }))).toEqual(
      opencode.commands.map((command) => ({ ...command, target: undefined })),
    );
    expect(promptAssets(pi).map(promptBody)).toEqual(promptAssets(opencode).map(promptBody));
    expect(promptAssets(pi).map((asset) => asset.target.segments.join('/'))).toEqual([
      '.pi/prompts/build.md',
      '.pi/prompts/continue.md',
      '.pi/prompts/plan.md',
      '.pi/prompts/refresh.md',
      '.pi/prompts/release.md',
      '.pi/prompts/verify.md',
      '.pi/skills/neottia-sdlc/SKILL.md',
    ]);
    expect(promptAssets(opencode).map((asset) => asset.target.segments.join('/'))).toEqual([
      '.opencode/commands/build.md',
      '.opencode/commands/continue.md',
      '.opencode/commands/plan.md',
      '.opencode/commands/refresh.md',
      '.opencode/commands/release.md',
      '.opencode/commands/verify.md',
      '.opencode/skills/neottia-sdlc/SKILL.md',
    ]);
    const skillBody = promptBody(promptAssets(pi).at(-1)!);
    expect(skillBody).toContain('neottia-sdlc:checkpoint');
    expect(skillBody).toContain('They do not grant host permissions.');
    expect(pi.assets.assets.filter((asset): asset is HostConfigAsset => asset.kind === 'host-config')).toHaveLength(2);
    expect(
      opencode.assets.assets.filter((asset): asset is HostConfigAsset => asset.kind === 'host-config'),
    ).toHaveLength(2);
    expect(promptAssets(pi).every((asset) => !asset.content.includes('{{neottia.'))).toBe(true);
    const continueBody = promptBody(promptAssets(pi).find((asset) => asset.target.segments.at(-1) === 'continue.md')!);
    expect(continueBody).toContain('Recommend exactly one supported next public command with its evidence');
    expect(continueBody).toContain('stop without invoking it');
  });

  it('compiles the same lifecycle bodies through the independent Claude Code adapter', () => {
    const pi = compileSdlc(
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
      }),
      piHarnessAdapter,
    );
    const claude = compileSdlc(
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'claude-code',
        scope: 'project',
      }),
      claudeCodeHarnessAdapter,
    );

    expect(claude.commands.map((command) => ({ ...command, target: undefined }))).toEqual(
      pi.commands.map((command) => ({ ...command, target: undefined })),
    );
    expect(promptAssets(claude).map(promptBody)).toEqual(promptAssets(pi).map(promptBody));
    expect(promptAssets(claude).map((asset) => asset.target.segments.join('/'))).toEqual([
      '.claude/commands/build.md',
      '.claude/commands/continue.md',
      '.claude/commands/plan.md',
      '.claude/commands/refresh.md',
      '.claude/commands/release.md',
      '.claude/commands/verify.md',
      '.claude/skills/neottia-sdlc/SKILL.md',
    ]);
    expect(claude.assets.assets.filter((asset) => asset.kind === 'host-config')).toEqual([]);
  });

  it('projects named OpenCode roles without granting permissions or unsupported thinking metadata', () => {
    const input = createSdlcCompilerInput(
      snapshot({
        'sdlc-role-assignments': {
          pi: REQUIRED_CURRENT_ASSIGNMENTS,
          opencode: {
            ...REQUIRED_CURRENT_ASSIGNMENTS,
            planner: {
              agent: 'neottia-planner',
              model: 'provider/model',
              thinking: 'high',
              required_skills: ['planning'],
              required_tools: ['issue_read'],
            },
          },
        },
      }),
      {
        compilerVersion: '0.1.0',
        harnessId: 'opencode',
        scope: 'project',
      },
    );
    const output = compileSdlc(input, opencodeHarnessAdapter);
    const agent = output.assets.assets.find(
      (asset) => asset.kind === 'file' && asset.id === 'asset.agent.neottia-planner',
    );
    const plan = output.assets.assets.find((asset) => asset.kind === 'file' && asset.id === 'asset.prompt.plan');

    expect(agent).toMatchObject({
      kind: 'file',
      target: { segments: ['.opencode', 'agents', 'neottia-planner.md'] },
    });
    expect(agent?.content).toContain('model: "provider/model"');
    expect(agent?.content).toContain('steps: 24');
    expect(agent?.content).not.toContain('thinking:');
    expect(agent?.content).not.toContain('permission:');
    expect(plan?.content).toContain('Invoke only the configured host subagent `neottia-planner`');
    expect(plan?.content).toContain('Thinking hint `high` is advisory');
    expect(plan?.content).toContain('Obtain explicit approval for the proposed scope before Build.');
    expect(output.assets.reloadNotice?.affectedFeatures).toContain('asset.agent');
    expect(input.configuration.provenance.map(({ path }) => path.join('.'))).toContain(
      'agents.sdlc.opencode.planner.model',
    );
    expect(input.configuration.provenance.map(({ path }) => path.join('.')).join('\n')).not.toContain('agents.sdlc.pi');
  });

  it('keeps unselected harness assignments out of checksums and provenance', () => {
    const createPi = (opencodePlanner: string): SdlcCompilerInputManifest =>
      createSdlcCompilerInput(
        snapshot({
          'sdlc-role-assignments': {
            pi: REQUIRED_CURRENT_ASSIGNMENTS,
            opencode: { ...REQUIRED_CURRENT_ASSIGNMENTS, planner: { agent: opencodePlanner } },
          },
        }),
        { compilerVersion: '0.1.0', harnessId: 'pi', scope: 'project' },
      );
    const left = createPi('planner-left');
    const right = createPi('planner-right');

    expect(left).toEqual(right);
    expect(JSON.stringify(left)).not.toContain('planner-left');
    expect(JSON.stringify(right)).not.toContain('planner-right');
  });

  it('stops on missing required assignments and unsupported named routes before projection', () => {
    expect(() =>
      createSdlcCompilerInput(
        snapshot({
          'sdlc-role-assignments': {
            pi: { ...REQUIRED_CURRENT_ASSIGNMENTS, planner: false },
            opencode: REQUIRED_CURRENT_ASSIGNMENTS,
          },
        }),
        { compilerVersion: '0.1.0', harnessId: 'pi', scope: 'project' },
      ),
    ).toThrowError(
      expect.objectContaining({
        problems: [expect.objectContaining({ code: 'ROLE_ASSIGNMENT_REQUIRED' })],
      }),
    );
    expect(() =>
      createSdlcCompilerInput(
        snapshot({
          'sdlc-role-assignments': {
            pi: { ...REQUIRED_CURRENT_ASSIGNMENTS, planner: { agent: 'neottia-planner' } },
            opencode: REQUIRED_CURRENT_ASSIGNMENTS,
          },
        }),
        { compilerVersion: '0.1.0', harnessId: 'pi', scope: 'project' },
      ),
    ).toThrowError(
      expect.objectContaining({
        problems: [expect.objectContaining({ code: 'ROLE_ASSIGNMENT_UNSUPPORTED' })],
      }),
    );
  });

  it.each([
    {
      provider: 'github',
      documents: true,
      connection: {
        base_url: 'https://github.example.test',
        credential_environment: 'GITHUB_TOKEN',
      },
      command: 'gh',
    },
    {
      provider: 'gitlab',
      documents: true,
      connection: {
        base_url: 'https://gitlab.example.test/root/',
        credential_environment: 'GITLAB_TOKEN',
      },
      command: 'glab',
    },
    {
      provider: 'gitea',
      documents: false,
      connection: {
        base_url: 'https://gitea.example.test',
        credential_environment: 'GITEA_TOKEN',
        mcp: {
          issues: { server: 'gitea', command: 'gitea-mcp-server' },
          remote_source_control: { server: 'gitea', command: 'gitea-mcp-server' },
        },
      },
      command: 'gitea-mcp-server',
    },
    {
      provider: 'forgejo',
      documents: false,
      connection: {
        base_url: 'https://forgejo.example.test',
        credential_environment: 'FORGEJO_TOKEN',
        mcp: {
          issues: { server: 'forgejo', command: 'forgejo-mcp-server' },
          remote_source_control: { server: 'forgejo', command: 'forgejo-mcp-server' },
        },
      },
      command: 'forgejo-mcp-server',
    },
  ] as const)(
    'compiles equivalent Pi and OpenCode semantics for $provider',
    ({ provider, documents, connection, command }) => {
      const values = {
        'sdlc-issues-capability': { provider },
        'sdlc-documents-capability': { provider: documents ? provider : 'filesystem' },
        'sdlc-source-control-capability': { local: 'git', remote: provider, workspaces: false },
        'sdlc-forge-connections': { [provider]: connection },
      } as ConfigShardValues;
      const piInput = createSdlcCompilerInput(snapshot(values), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
      });
      const opencodeInput = createSdlcCompilerInput(snapshot(values), {
        compilerVersion: '0.1.0',
        harnessId: 'opencode',
        scope: 'project',
      });
      const pi = compileSdlc(piInput, piHarnessAdapter);
      const opencode = compileSdlc(opencodeInput, opencodeHarnessAdapter);
      const piBodies = promptAssets(pi).map(promptBody);

      expect(piBodies).toEqual(promptAssets(opencode).map(promptBody));
      expect(piBodies.join('\n')).toContain('choose exactly one available tool');
      expect(piBodies.join('\n')).toContain('never retry the same mutation through another tool');
      expect(piBodies.join('\n')).toContain('separate explicit authorization');
      expect(piInput.instructions.filter((pack) => pack.provider === provider).map((pack) => pack.slot)).toEqual(
        documents ? ['documents', 'issues', 'source-control.remote'] : ['issues', 'source-control.remote'],
      );
      expect(pi.assets.prerequisites).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'configuration',
            check: { kind: 'environment', variable: connection.credential_environment },
            instructions: expect.any(String),
          }),
          expect.objectContaining({
            check: { kind: 'command', command },
            instructions: expect.any(String),
          }),
        ]),
      );
      for (const other of ['github', 'gitlab', 'gitea', 'forgejo', 'bitbucket', 'jira', 'confluence'].filter(
        (candidate) => candidate !== provider,
      )) {
        expect(piBodies.join('\n')).not.toContain(`https://${other}.example.test`);
      }
    },
  );

  it('compiles equivalent mixed Jira, Confluence, and Bitbucket semantics for Pi and OpenCode', () => {
    const service = { server: 'atlassian', command: 'mcp-remote' };
    const values = {
      'sdlc-issues-capability': { provider: 'jira' },
      'sdlc-documents-capability': { provider: 'confluence' },
      'sdlc-source-control-capability': { local: 'git', remote: 'bitbucket', workspaces: false },
      'sdlc-forge-connections': {
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
        bitbucket: {
          base_url: 'https://bitbucket.org/example',
          credential_environment: 'BITBUCKET_TOKEN',
          mcp: { remote_source_control: service },
        },
      },
    } satisfies ConfigShardValues;
    const piInput = createSdlcCompilerInput(snapshot(values), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
    });
    const opencodeInput = createSdlcCompilerInput(snapshot(values), {
      compilerVersion: '0.1.0',
      harnessId: 'opencode',
      scope: 'project',
    });
    const pi = compileSdlc(piInput, piHarnessAdapter);
    const opencode = compileSdlc(opencodeInput, opencodeHarnessAdapter);
    const bodies = promptAssets(pi).map(promptBody);
    const prerequisites = pi.assets.prerequisites;

    expect(bodies).toEqual(promptAssets(opencode).map(promptBody));
    expect(
      piInput.instructions
        .filter((pack) => ['bitbucket', 'jira', 'confluence'].includes(pack.provider))
        .map((pack) => pack.id),
    ).toEqual(['neottia.documents.confluence', 'neottia.issues.jira', 'neottia.source-control.remote.bitbucket']);
    expect(bodies.join('\n')).toContain('Jira work item search');
    expect(bodies.join('\n')).toContain('current content, space, parent, and version');
    expect(bodies.join('\n')).toContain('Bitbucket pull requests');
    expect(bodies.join('\n')).toContain('Require an explicit release operation');
    for (const variable of ['BITBUCKET_TOKEN', 'CONFLUENCE_TOKEN', 'JIRA_TOKEN']) {
      expect(prerequisites).toContainEqual(expect.objectContaining({ check: { kind: 'environment', variable } }));
    }
    expect(
      prerequisites.filter(
        (prerequisite) => prerequisite.check.kind === 'command' && prerequisite.check.command === 'mcp-remote',
      ),
    ).toHaveLength(3);
    expect(
      prerequisites.some(
        (prerequisite) => prerequisite.check.kind === 'command' && ['gh', 'glab'].includes(prerequisite.check.command),
      ),
    ).toBe(false);
    expect(pi.commands.find((command) => command.id === 'plan')?.instructionPackIds).not.toContain(
      'neottia.source-control.remote.bitbucket',
    );
    expect(pi.commands.find((command) => command.id === 'release')?.instructionPackIds).not.toContain(
      'neottia.documents.confluence',
    );
  });

  it('renders only the instruction blocks used by each lifecycle template', () => {
    const input = createSdlcCompilerInput(
      snapshot({
        'sdlc-issues-capability': { provider: 'github' },
        'sdlc-documents-capability': { provider: 'github' },
        'sdlc-source-control-capability': { local: 'git', remote: 'github', workspaces: false },
        'sdlc-forge-connections': {
          github: {
            base_url: 'https://github.example.test',
            credential_environment: 'GITHUB_TOKEN',
          },
        },
      }),
      { compilerVersion: '0.1.0', harnessId: 'pi', scope: 'project' },
    );
    const output = compileSdlc(input, piHarnessAdapter);
    const body = (command: string): string =>
      promptBody(promptAssets(output).find((asset) => asset.target.segments.at(-1) === `${command}.md`)!);

    for (const command of ['plan', 'build']) {
      expect(body(command)).not.toContain('## Compiled remote source-control instructions');
      expect(output.commands.find((candidate) => candidate.id === command)?.instructionPackIds).not.toContain(
        'neottia.source-control.remote.github',
      );
    }
    expect(body('verify')).toContain('## Compiled remote source-control instructions');
    expect(body('release')).not.toContain('## Compiled Documents instructions');
    expect(output.commands.find((command) => command.id === 'release')?.instructionPackIds).not.toContain(
      'neottia.documents.github',
    );
  });

  it('does not require a forge CLI when configured MCP covers every CLI-backed capability', () => {
    const input = createSdlcCompilerInput(
      snapshot({
        'sdlc-issues-capability': { provider: 'github' },
        'sdlc-source-control-capability': { local: 'git', remote: 'github', workspaces: false },
        'sdlc-forge-connections': {
          github: {
            base_url: 'https://github.example.test',
            credential_environment: 'GITHUB_TOKEN',
            mcp: {
              issues: { server: 'github', command: 'github-mcp-server' },
              remote_source_control: { server: 'github', command: 'github-mcp-server' },
            },
          },
        },
      }),
      {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
      },
    );
    const commands = compileSdlc(input, piHarnessAdapter).assets.prerequisites.flatMap((prerequisite) =>
      prerequisite.check.kind === 'command' ? [prerequisite.check.command] : [],
    );

    expect(commands).toContain('github-mcp-server');
    expect(commands).toContain('git');
    expect(commands).not.toContain('gh');
  });

  it('does not require Git when MCP covers forge documents and remote source control is disabled', () => {
    const input = createSdlcCompilerInput(
      snapshot({
        'sdlc-documents-capability': { provider: 'github' },
        'sdlc-source-control-capability': { local: 'jj', remote: false, workspaces: false },
        'sdlc-forge-connections': {
          github: {
            base_url: 'https://github.example.test',
            credential_environment: 'GITHUB_TOKEN',
            mcp: {
              documents: { server: 'github', command: 'github-mcp-server' },
            },
          },
        },
      }),
      {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
        instructionPacks: [
          createSdlcInstructionPack({
            id: 'example.source-control.local.jj',
            slot: 'source-control.local',
            provider: 'jj',
            version: '1.0.0',
            content: 'Use Jujutsu for local source control.\n',
          }),
        ],
      },
    );
    const commands = compileSdlc(input, piHarnessAdapter).assets.prerequisites.flatMap((prerequisite) =>
      prerequisite.check.kind === 'command' ? [prerequisite.check.command] : [],
    );

    expect(commands).toContain('github-mcp-server');
    expect(commands).toContain('jj');
    expect(commands).not.toContain('git');
  });

  it('returns actionable doctor results for missing forge tools, credentials, and MCP services', async () => {
    const input = createSdlcCompilerInput(
      snapshot({
        'sdlc-issues-capability': { provider: 'forgejo' },
        'sdlc-source-control-capability': { local: 'git', remote: 'forgejo', workspaces: false },
        'sdlc-forge-connections': {
          forgejo: {
            base_url: 'https://forgejo.example.test',
            credential_environment: 'FORGEJO_TOKEN',
            mcp: {
              issues: { server: 'forgejo', command: 'forgejo-mcp-server' },
              remote_source_control: { server: 'forgejo', command: 'forgejo-mcp-server' },
            },
          },
        },
      }),
      {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
      },
    );
    const output = compileSdlc(input, piHarnessAdapter);
    const roots = { project: '/tmp/project', home: '/tmp/home', xdgConfig: '/tmp/config', xdgState: '/tmp/state' };
    const results = await runDoctor(output.assets, roots, { PATH: '' });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'configuration',
          status: 'error',
          instructions: expect.stringContaining('FORGEJO_TOKEN'),
        }),
        expect.objectContaining({
          category: 'mcp-server',
          status: 'error',
          instructions: expect.stringContaining('forgejo-mcp-server'),
        }),
        expect.objectContaining({
          category: 'tool',
          status: 'error',
          instructions: expect.stringContaining('Install Git'),
        }),
      ]),
    );
  });

  it('is byte-deterministic across input enumeration and cloned manifests', () => {
    const options = {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project' as const,
      runtimePackages: [...runtimePackages].reverse(),
    };
    const leftInput = createSdlcCompilerInput(snapshot(), options);
    const rightInput = createSdlcCompilerInput(snapshot(), { ...options, runtimePackages });
    expect(leftInput).toEqual(rightInput);

    const left = compileSdlc(leftInput, piHarnessAdapter);
    const right = compileSdlc(structuredClone(rightInput), piHarnessAdapter);
    expect(left).toEqual(right);
    expect(left.checksum).toBe(right.checksum);
    expect(left.assets.checksum).toBe(right.assets.checksum);
  });

  it('changes only the selected instruction section when a provider changes', () => {
    const filesystemInput = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
      runtimePackages,
    });
    const githubInput = createSdlcCompilerInput(
      snapshot({
        'sdlc-issues-capability': { provider: 'github' },
        'sdlc-forge-connections': {
          github: {
            base_url: 'https://github.example.test',
            credential_environment: 'GITHUB_TOKEN',
          },
        },
      }),
      {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
        runtimePackages,
      },
    );
    const filesystem = compileSdlc(filesystemInput, piHarnessAdapter);
    const github = compileSdlc(githubInput, piHarnessAdapter);
    const filesystemIssues = BUILTIN_SDLC_INSTRUCTION_PACKS.find((pack) => pack.slot === 'issues')!.content.trimEnd();
    const githubIssues = githubInput.instructions.find((pack) => pack.slot === 'issues')!.content.trimEnd();

    expect(promptAssets(filesystem).map((asset) => promptBody(asset).replace(filesystemIssues, '<issues>'))).toEqual(
      promptAssets(github).map((asset) => promptBody(asset).replace(githubIssues, '<issues>')),
    );
    expect(filesystem.assets.assets.filter((asset) => asset.kind === 'host-config')).toEqual(
      github.assets.assets.filter((asset) => asset.kind === 'host-config'),
    );
  });

  it('records complete template overrides and configured role instructions', () => {
    const packagedPlan = packagedTemplateLayer.files.find((template) => template.id === 'neottia.sdlc.command.plan')!;
    const override = packagedPlan.content.replace('Turn the request', 'Turn the reviewed request');
    const input = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
      templateLayers: [
        {
          tier: 'project',
          sourceId: 'project-templates',
          version: 'revision-1',
          files: [{ id: packagedPlan.id, content: override }],
        },
      ],
    });
    const output = compileSdlc(input, piHarnessAdapter);
    const plan = promptAssets(output).find((asset) => asset.target.segments.at(-1) === 'plan.md')!;
    const build = promptAssets(output).find((asset) => asset.target.segments.at(-1) === 'build.md')!;

    expect(plan.content).toContain('Turn the reviewed request');
    expect(plan.content).toContain('The selected assignment explicitly requires the current agent');
    expect(plan.content).toContain('No dedicated agent is assigned for this optional role');
    expect(plan.content).toContain('at most 20 evidence entries');
    expect(build.content).toContain('Portable role: implementer.');
    expect(build.content).not.toContain('owned by the role compiler');
    expect(input.templates.find((template) => template.id === packagedPlan.id)).toMatchObject({
      sourceId: 'project-templates',
      checksum: checksumText(override),
      shadowed: [expect.objectContaining({ sourceId: '@neottia/sdlc' })],
    });
  });

  it('fails compilation before projection when a selected instruction pack is missing', () => {
    expect(() =>
      createSdlcCompilerInput(
        snapshot({
          'sdlc-source-control-capability': { local: 'jj', remote: false, workspaces: false },
        }),
        {
          compilerVersion: '0.1.0',
          harnessId: 'pi',
          scope: 'project',
        },
      ),
    ).toThrow('No instruction pack exists for source-control.local:jj.');
  });

  it('rejects malformed checksums, duplicate selections, and package ranges', () => {
    const filesystemIssues = BUILTIN_SDLC_INSTRUCTION_PACKS.find((pack) => pack.slot === 'issues')!;
    expect(() =>
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
        instructionPacks: [{ ...filesystemIssues, checksum: checksumText('tampered') }],
      }),
    ).toThrow('Instruction pack checksum does not match.');
    expect(() =>
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
        instructionPacks: [filesystemIssues],
      }),
    ).toThrow('Instruction pack selection is ambiguous for issues:filesystem.');
    expect(() =>
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
        runtimePackages: [{ logicalId: 'issues', version: '^0.1.0' }],
      }),
    ).toThrow('Runtime package issues version is invalid.');
    expect(
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
        runtimePackages: [{ logicalId: 'issues', version: '1.2.3+build.5' }],
      }).runtimePackages[0]?.version,
    ).toBe('1.2.3+build.5');
    for (const version of ['01.2.3', '1.2.3-01']) {
      expect(() =>
        createSdlcCompilerInput(snapshot(), {
          compilerVersion: '0.1.0',
          harnessId: 'pi',
          scope: 'project',
          runtimePackages: [{ logicalId: 'issues', version }],
        }),
      ).toThrow('Runtime package issues version is invalid.');
    }
  });

  it('requires every stable insertion fragment exactly once after template resolution', () => {
    const packagedLayout = packagedTemplateLayer.files.find((template) => template.id === 'neottia.sdlc.layout')!;
    expect(() =>
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
        templateLayers: [
          {
            tier: 'project',
            sourceId: 'broken-project-template',
            version: 'revision-1',
            files: [
              {
                id: packagedLayout.id,
                content: packagedLayout.content.replace('{{ instructions.issues }}', ''),
              },
            ],
          },
        ],
      }),
    ).toThrow('must output instructions.issues directly exactly once.');

    const spoofed = packagedLayout.content.replace(
      '{{ instructions.issues }}',
      '{% if instructions.issues == "NEOTTIA_SLOT_ISSUES_1A7F" %}{{ instructions.issues }}{% endif %}',
    );
    expect(() =>
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
        templateLayers: [
          {
            tier: 'project',
            sourceId: 'spoofed-project-template',
            version: 'revision-1',
            files: [{ id: packagedLayout.id, content: spoofed }],
          },
        ],
      }),
    ).toThrow('must output instructions.issues directly exactly once.');
  });

  it('accepts identical configured role fragments at distinct invocation points', () => {
    const input = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
    });
    const plannerRoles = input.roles.filter((role) => role.role === 'planner');
    const output = compileSdlc(input, piHarnessAdapter);

    expect(plannerRoles.map((role) => role.command)).toEqual(['plan', 'continue']);
    expect(new Set(plannerRoles.map((role) => role.checksum)).size).toBe(1);
    expect(promptBody(promptAssets(output).find((asset) => asset.target.segments.at(-1) === 'plan.md')!)).toContain(
      'Portable role: planner.',
    );
    expect(promptBody(promptAssets(output).find((asset) => asset.target.segments.at(-1) === 'continue.md')!)).toContain(
      'Portable role: planner.',
    );
  });

  it('restores replacement-token fragments literally after tracked rendering', () => {
    const instruction = "Use provider tokens $&, $`, and $' literally.\n";
    const output = compileSdlc(
      createSdlcCompilerInput(
        snapshot({
          'sdlc-source-control-capability': { local: 'jj', remote: false, workspaces: false },
        }),
        {
          compilerVersion: '0.1.0',
          harnessId: 'pi',
          scope: 'project',
          instructionPacks: [
            createSdlcInstructionPack({
              id: 'test.source-control.jj',
              slot: 'source-control.local',
              provider: 'jj',
              version: '1.0.0',
              content: instruction,
            }),
          ],
        },
      ),
      piHarnessAdapter,
    );
    const plan = promptBody(promptAssets(output).find((asset) => asset.target.segments.at(-1) === 'plan.md')!);

    expect(plan.split(instruction.trimEnd())).toHaveLength(2);
    expect(plan).not.toContain('NEOTTIA_FRAGMENT_');
  });

  it('rejects missing variables and unsafe Twig functions before projection', () => {
    const packagedPlan = packagedTemplateLayer.files.find((template) => template.id === 'neottia.sdlc.command.plan')!;
    for (const [expression, expected] of [
      ['{{ missing.value }}', /missing/iu],
      ['{{ random() }}', /random.*not allowed/iu],
      ['{{ range(0, 1000000000) }}', /range.*not allowed/iu],
      ['{% include "neottia.sdlc.command.plan" %}', /include.*not allowed/iu],
      ['{{ block("purpose") }}', /block.*not allowed/iu],
      [
        '{% for role in roles %}{% for point in command.approvalPoints %}x{% endfor %}{% endfor %}',
        /nested Twig loops/iu,
      ],
    ] as const) {
      expect(() =>
        createSdlcCompilerInput(snapshot(), {
          compilerVersion: '0.1.0',
          harnessId: 'pi',
          scope: 'project',
          templateLayers: [
            {
              tier: 'project',
              sourceId: 'unsafe-project-template',
              version: 'revision-1',
              files: [
                {
                  id: packagedPlan.id,
                  content: packagedPlan.content.replace('{% endblock %}', ` ${expression}{% endblock %}`),
                },
              ],
            },
          ],
        }),
      ).toThrow(expected);
    }

    const recursivePlans = [
      packagedPlan.content.replace('"neottia.sdlc.layout"', '"neottia.sdlc.command.plan"'),
      packagedPlan.content.replace(
        '{% extends "neottia.sdlc.layout" %}',
        '{%- extends "neottia.sdlc.command.plan" -%}',
      ),
    ];
    for (const recursivePlan of recursivePlans) {
      expect(() =>
        createSdlcCompilerInput(snapshot(), {
          compilerVersion: '0.1.0',
          harnessId: 'pi',
          scope: 'project',
          templateLayers: [
            {
              tier: 'project',
              sourceId: 'recursive-project-template',
              version: 'revision-1',
              files: [{ id: packagedPlan.id, content: recursivePlan }],
            },
          ],
        }),
      ).toThrow('may extend only neottia.sdlc.layout.');
    }
  });

  it('validates input checksums before adapter projection', () => {
    const input = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
    });
    expect(() => compileSdlc({ ...input, checksum: checksumText('tampered') }, piHarnessAdapter)).toThrow(
      'SDLC compiler input checksum does not match.',
    );
  });

  it('rejects contradictory decoded manifests before adapter projection', () => {
    const input = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
    });
    const githubContext = structuredClone({
      ...input.configuration.context,
      issues: { provider: 'github' as const },
    });
    const githubConfiguration = {
      ...input.configuration,
      context: githubContext,
      checksum: checksumText(canonicalJson({ context: githubContext, roles: input.configuration.roles })),
    };
    const changedTemplate = { ...input.templates[0]!, content: `${input.templates[0]!.content}\nTampered.\n` };
    const cases = [
      [
        resignCompilerInput(input, {
          configuration: { ...input.configuration, checksum: checksumText('stale configuration') },
        }),
        'configuration checksum does not match',
      ],
      [
        resignCompilerInput(input, { configuration: githubConfiguration }),
        'forge connections do not match selected capabilities',
      ],
      [
        resignCompilerInput(input, { instructions: input.instructions.slice(1) }),
        'instruction pack selection is incomplete',
      ],
      [
        resignCompilerInput(input, { templates: [changedTemplate, ...input.templates.slice(1)] }),
        'template neottia.sdlc.command.build checksum does not match',
      ],
      [
        resignCompilerInput(input, { instructions: [...input.instructions].reverse() }),
        'instruction packs are not in canonical order',
      ],
    ] as const;
    let adapterCalls = 0;
    const spyAdapter = {
      ...piHarnessAdapter,
      projectPrompt(request: Parameters<typeof piHarnessAdapter.projectPrompt>[0]) {
        adapterCalls += 1;
        return piHarnessAdapter.projectPrompt(request);
      },
    };

    for (const [manifest, message] of cases) {
      const decoded = JSON.parse(JSON.stringify(manifest)) as SdlcCompilerInputManifest;
      expect(() => compileSdlc(decoded, spyAdapter)).toThrow(message);
    }
    expect(adapterCalls).toBe(0);
  });

  it('rejects conflicting MCP commands across selected forge connections', () => {
    expect(() =>
      createSdlcCompilerInput(
        snapshot({
          'sdlc-issues-capability': { provider: 'github' },
          'sdlc-source-control-capability': { local: 'git', remote: 'gitlab', workspaces: false },
          'sdlc-forge-connections': {
            github: {
              base_url: 'https://github.example.test',
              credential_environment: 'GITHUB_TOKEN',
              mcp: { issues: { server: 'shared-forge', command: 'github-mcp-server' } },
            },
            gitlab: {
              base_url: 'https://gitlab.example.test',
              credential_environment: 'GITLAB_TOKEN',
              mcp: { remote_source_control: { server: 'shared-forge', command: 'gitlab-mcp-server' } },
            },
          },
        }),
        { compilerVersion: '0.1.0', harnessId: 'pi', scope: 'project' },
      ),
    ).toThrow('forge MCP server maps to conflicting commands');
  });

  it('rejects conflicting MCP commands in resigned compiler inputs', () => {
    const input = createSdlcCompilerInput(
      snapshot({
        'sdlc-issues-capability': { provider: 'github' },
        'sdlc-source-control-capability': { local: 'git', remote: 'github', workspaces: false },
        'sdlc-forge-connections': {
          github: {
            base_url: 'https://github.example.test',
            credential_environment: 'GITHUB_TOKEN',
            mcp: {
              issues: { server: 'github', command: 'github-mcp-server' },
              remote_source_control: { server: 'github', command: 'github-mcp-server' },
            },
          },
        },
      }),
      { compilerVersion: '0.1.0', harnessId: 'pi', scope: 'project' },
    );
    const context = structuredClone(input.configuration.context);
    context.forges[0]!.mcp.remoteSourceControl!.command = 'other-mcp-server';
    const configuration = {
      ...input.configuration,
      context,
      checksum: checksumText(canonicalJson({ context, roles: input.configuration.roles })),
    };

    expect(() => compileSdlc(resignCompilerInput(input, { configuration }), piHarnessAdapter)).toThrow(
      'forge MCP server maps to conflicting commands',
    );
  });

  it('preserves adapter diagnostics without guessing an alternate projection', () => {
    const input = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
    });
    const failingAdapter = {
      ...piHarnessAdapter,
      projectPrompt() {
        return {
          diagnostics: [
            {
              code: 'INVALID_CONTENT' as const,
              hostId: 'pi',
              feature: 'asset.prompt' as const,
              message: 'Prompt projection was rejected by the test adapter.',
            },
          ],
        };
      },
    };

    let failure: unknown;
    try {
      compileSdlc(input, failingAdapter);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SdlcCompilerError);
    expect((failure as SdlcCompilerError).diagnostics).toEqual([
      expect.objectContaining({ code: 'INVALID_CONTENT', hostId: 'pi' }),
    ]);
  });
});
