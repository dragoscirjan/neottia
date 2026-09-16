import { createConfigRegistry, createResolvedConfigSnapshot, type ConfigShardValues } from '@neottia/config';
import { designDocsConfigContribution } from '@neottia/design-docs';
import { canonicalJson, checksumText, type FileAsset, type HostConfigAsset } from '@neottia/distribution';
import { issueConfigContribution } from '@neottia/issues';
import { describe, expect, it } from 'vitest';

import { compileSdlc, createSdlcCompilerInput, SdlcCompilerError, type SdlcCompilerInputManifest } from './compiler.js';
import {
  documentsCapabilityConfigContribution,
  issuesCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
} from './config.js';
import {
  BUILTIN_SDLC_INSTRUCTION_PACKS,
  createSdlcInstructionPack,
  createSdlcRoleInstruction,
} from './instructions.js';
import { PACKAGED_LIFECYCLE_TEMPLATES, SDLC_COMMAND_IDS, SDLC_LIFECYCLE } from './lifecycle.js';

import { opencodeHarnessAdapter } from '../../../extensions/opencode-adapter/src/index.js';
import { piHarnessAdapter } from '../../../extensions/pi-adapter/src/index.js';

const registry = createConfigRegistry([
  issueConfigContribution,
  designDocsConfigContribution,
  issuesCapabilityConfigContribution,
  documentsCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
]);
const runtimePackages = [
  { logicalId: 'issues' as const, version: '0.1.0' },
  { logicalId: 'design-docs' as const, version: '0.1.0' },
];

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
    expect(new Set(SDLC_LIFECYCLE.flatMap((command) => command.approvalPoints)).size).toBeGreaterThan(3);
    expect(SDLC_LIFECYCLE.every((command) => command.stopConditions.length > 0)).toBe(true);
    expect(SDLC_LIFECYCLE.find((command) => command.id === 'plan')?.roleSlots).toEqual(['planner', 'researcher']);
    for (const template of PACKAGED_LIFECYCLE_TEMPLATES.files) {
      expect(template.content).not.toMatch(/\b(?:github|gitlab|jira|confluence|filesystem)\b/iu);
      expect(template.content).not.toMatch(/`(?:issue_|document_|git\b)/u);
      expect(template.content).toContain('They do not grant host permissions.');
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
    const githubPack = createSdlcInstructionPack({
      id: 'example.issues.github',
      slot: 'issues',
      provider: 'github',
      version: '1.0.0',
      content: 'Use the configured GitHub issue integration and preserve issue-number evidence.\n',
    });
    const filesystemInput = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
      instructionPacks: [githubPack],
      runtimePackages,
    });
    const githubInput = createSdlcCompilerInput(snapshot({ 'sdlc-issues-capability': { provider: 'github' } }), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
      instructionPacks: [githubPack],
      runtimePackages,
    });
    const filesystem = compileSdlc(filesystemInput, piHarnessAdapter);
    const github = compileSdlc(githubInput, piHarnessAdapter);
    const filesystemIssues = BUILTIN_SDLC_INSTRUCTION_PACKS.find((pack) => pack.slot === 'issues')!.content.trimEnd();
    const githubIssues = githubPack.content.trimEnd();

    expect(promptAssets(filesystem).map((asset) => promptBody(asset).replace(filesystemIssues, '<issues>'))).toEqual(
      promptAssets(github).map((asset) => promptBody(asset).replace(githubIssues, '<issues>')),
    );
    expect(filesystem.assets.assets.filter((asset) => asset.kind === 'host-config')).toEqual(
      github.assets.assets.filter((asset) => asset.kind === 'host-config'),
    );
  });

  it('records complete template overrides and optional role instructions', () => {
    const packagedPlan = PACKAGED_LIFECYCLE_TEMPLATES.files.find(
      (template) => template.id === 'neottia.sdlc.command.plan',
    )!;
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

  it('requires every stable insertion token exactly once after template resolution', () => {
    const packagedPlan = PACKAGED_LIFECYCLE_TEMPLATES.files.find(
      (template) => template.id === 'neottia.sdlc.command.plan',
    )!;
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
              { id: packagedPlan.id, content: packagedPlan.content.replace('{{neottia.instructions.role}}', '') },
            ],
          },
        ],
      }),
    ).toThrow('must contain slot {{neottia.instructions.role}} exactly once.');
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
        'does not match selected provider for issues',
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
