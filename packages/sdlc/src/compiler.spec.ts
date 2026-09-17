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
import {
  BUILTIN_SDLC_INSTRUCTION_PACKS,
  createSdlcInstructionPack,
  createSdlcRoleInstruction,
} from './instructions.js';
import { SDLC_COMMAND_IDS, SDLC_LIFECYCLE } from './lifecycle.js';
import { loadPackagedSdlcTemplateLayer } from './template-loader.js';

import { opencodeHarnessAdapter } from '../../../extensions/opencode-adapter/src/index.js';
import { piHarnessAdapter } from '../../../extensions/pi-adapter/src/index.js';

const registry = createConfigRegistry([
  issueConfigContribution,
  designDocsConfigContribution,
  forgeConnectionsConfigContribution,
  issuesCapabilityConfigContribution,
  documentsCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
]);
const runtimePackages = [
  { logicalId: 'issues' as const, version: '0.1.0' },
  { logicalId: 'design-docs' as const, version: '0.1.0' },
];
const packagedTemplateLayer = await loadPackagedSdlcTemplateLayer();

type TestCompilerInputOptions = Omit<CreateSdlcCompilerInputOptions, 'templateLayers'> & {
  readonly templateLayers?: CreateSdlcCompilerInputOptions['templateLayers'];
};

/** Adds the external packaged templates to one pure compiler invocation. */
function createSdlcCompilerInput(
  resolvedSnapshot: Parameters<typeof createRawSdlcCompilerInput>[0],
  options: TestCompilerInputOptions,
): SdlcCompilerInputManifest {
  return createRawSdlcCompilerInput(resolvedSnapshot, {
    ...options,
    templateLayers: [packagedTemplateLayer, ...(options.templateLayers ?? [])],
  });
}

/** Creates a complete compiler snapshot without reading ambient configuration. */
function snapshot(values: ConfigShardValues = {}) {
  return createResolvedConfigSnapshot(registry, {
    issues: { enabled: true },
    'design-docs': { enabled: true },
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
      expect(template.content).not.toMatch(/\b(?:github|gitlab|jira|confluence|filesystem)\b/iu);
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
    ]);
    expect(promptAssets(opencode).map((asset) => asset.target.segments.join('/'))).toEqual([
      '.opencode/commands/build.md',
      '.opencode/commands/continue.md',
      '.opencode/commands/plan.md',
      '.opencode/commands/refresh.md',
      '.opencode/commands/release.md',
      '.opencode/commands/verify.md',
    ]);
    expect(pi.assets.assets.filter((asset): asset is HostConfigAsset => asset.kind === 'host-config')).toHaveLength(2);
    expect(
      opencode.assets.assets.filter((asset): asset is HostConfigAsset => asset.kind === 'host-config'),
    ).toHaveLength(2);
    expect(promptAssets(pi).every((asset) => !asset.content.includes('{{neottia.'))).toBe(true);
    const continueBody = promptBody(promptAssets(pi).find((asset) => asset.target.segments.at(-1) === 'continue.md')!);
    expect(continueBody).toContain('Recommend exactly one supported next public command with its evidence');
    expect(continueBody).toContain('stop without invoking it');
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
      for (const other of ['github', 'gitlab', 'gitea', 'forgejo'].filter((candidate) => candidate !== provider)) {
        expect(piBodies.join('\n')).not.toContain(`https://${other}.example.test`);
      }
    },
  );

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

  it('records complete template overrides and optional role instructions', () => {
    const packagedPlan = packagedTemplateLayer.files.find((template) => template.id === 'neottia.sdlc.command.plan')!;
    const override = packagedPlan.content.replace('Turn the request', 'Turn the reviewed request');
    const role = createSdlcRoleInstruction({
      id: 'example.role.planner',
      command: 'plan',
      role: 'planner',
      version: '1.0.0',
      content: 'Invoke the compiled planner role and require its structured handoff.\n',
    });
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
      roles: [role],
    });
    const output = compileSdlc(input, piHarnessAdapter);
    const plan = promptAssets(output).find((asset) => asset.target.segments.at(-1) === 'plan.md')!;
    const build = promptAssets(output).find((asset) => asset.target.segments.at(-1) === 'build.md')!;

    expect(plan.content).toContain('Turn the reviewed request');
    expect(plan.content).toContain(role.content.trimEnd());
    expect(plan.content).toContain('### researcher');
    expect(plan.content).toContain('No role instructions are compiled for these invocation points: researcher');
    expect(build.content).toContain('No role instructions are compiled for these invocation points: implementer');
    expect(build.content).toContain('fallback behavior are owned by the role compiler.');
    expect(input.templates.find((template) => template.id === packagedPlan.id)).toMatchObject({
      sourceId: 'project-templates',
      checksum: checksumText(override),
      shadowed: [expect.objectContaining({ sourceId: '@neottia/sdlc' })],
    });
  });

  it('fails compilation before projection when a selected instruction pack is missing', () => {
    expect(() =>
      createSdlcCompilerInput(snapshot({ 'sdlc-documents-capability': { provider: 'confluence' } }), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
      }),
    ).toThrow('No instruction pack exists for documents:confluence.');
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

  it('accepts identical role fragments at distinct invocation points', () => {
    const content = 'Plan\n';
    const roles = [
      createSdlcRoleInstruction({
        id: 'example.role.planner',
        command: 'plan',
        role: 'planner',
        version: '1.0.0',
        content,
      }),
      createSdlcRoleInstruction({
        id: 'example.role.researcher',
        command: 'plan',
        role: 'researcher',
        version: '1.0.0',
        content,
      }),
    ];
    const input = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
      roles,
    });
    const output = compileSdlc(input, piHarnessAdapter);
    const plan = promptBody(promptAssets(output).find((asset) => asset.target.segments.at(-1) === 'plan.md')!);

    expect(plan).toContain('### planner\n\nPlan');
    expect(plan).toContain('### researcher\n\nPlan');
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
      checksum: checksumText(canonicalJson(githubContext)),
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
      checksum: checksumText(canonicalJson(context)),
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
