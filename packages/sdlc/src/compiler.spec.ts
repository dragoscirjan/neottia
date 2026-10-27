import { createConfigRegistry, createResolvedConfigSnapshot, type ConfigShardValues } from '@neottia/config';
import { designDocsConfigContribution } from '@neottia/design-docs';
import { canonicalJson, checksumText, runDoctor, type FileAsset, type HostConfigAsset } from '@neottia/distribution';
import { issueConfigContribution } from '@neottia/issues';
import { memoryConfigContribution } from '@neottia/memory-core';
import { searchableConfigContribution } from '@neottia/searchable-core';
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
  memoryCapabilityConfigContribution,
  searchableCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
} from './config.js';
import { forgeConnectionsConfigContribution } from './forge-config.js';
import { BUILTIN_SDLC_INSTRUCTION_PACKS, createSdlcInstructionPack } from './instructions.js';
import {
  SDLC_COMMAND_IDS,
  SDLC_HOST_COMMAND_IDS,
  SDLC_LIFECYCLE,
  SDLC_PROJECT_APPEND_TEMPLATE_IDS,
  type SdlcCommandId,
} from './lifecycle.js';
import { sdlcRoleAssignmentsConfigContribution } from './role-config.js';
import { loadPackagedSdlcTemplateLayer } from './template-loader.js';

import { claudeCodeHarnessAdapter } from '../../../extensions/claude-code-adapter/src/index.js';
import { opencodeHarnessAdapter } from '../../../extensions/opencode-adapter/src/index.js';
import { piHarnessAdapter } from '../../../extensions/pi-adapter/src/index.js';

const registry = createConfigRegistry([
  issueConfigContribution,
  designDocsConfigContribution,
  memoryConfigContribution,
  searchableConfigContribution,
  forgeConnectionsConfigContribution,
  sdlcRoleAssignmentsConfigContribution,
  issuesCapabilityConfigContribution,
  documentsCapabilityConfigContribution,
  memoryCapabilityConfigContribution,
  searchableCapabilityConfigContribution,
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

/** Returns one projected lifecycle command by its semantic identifier. */
function commandAsset(output: ReturnType<typeof compileSdlc>, commandId: SdlcCommandId): FileAsset {
  const assetId = `asset.prompt.${SDLC_HOST_COMMAND_IDS[commandId]}`;
  const asset = promptAssets(output).find((candidate) => candidate.id === assetId);
  if (asset === undefined) throw new Error(`Missing projected command asset: ${assetId}`);
  return asset;
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
  it('keeps semantic command IDs separate from host-facing command IDs', () => {
    expect(SDLC_COMMAND_IDS).toEqual(['plan', 'build', 'verify', 'release', 'continue', 'refresh', 'adopt']);
    expect(SDLC_HOST_COMMAND_IDS).toEqual({
      plan: 'neottia-plan',
      build: 'neottia-build',
      verify: 'neottia-verify',
      release: 'neottia-release',
      continue: 'neottia-continue',
      refresh: 'neottia-refresh',
      adopt: 'neottia-adopt',
    });
    expect(SDLC_LIFECYCLE).toHaveLength(7);
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
    expect(SDLC_LIFECYCLE.find((command) => command.id === 'adopt')).toMatchObject({
      roleSlots: ['researcher', 'documentation-writer', 'release-coordinator'],
      allowedNext: [],
    });
    expect(
      SDLC_LIFECYCLE.filter((command) => command.id !== 'adopt').every(
        (command) => !command.allowedNext.includes('adopt'),
      ),
    ).toBe(true);
    for (const template of packagedTemplateLayer.files) {
      expect(template.content).not.toMatch(/\b(?:github|gitlab|bitbucket|jira|confluence|filesystem)\b/iu);
      expect(template.content).not.toMatch(/`(?:issue_|document_|git\b)/u);
    }
  });

  it('compiles adoption safety, provider, approval, pull-request, and repeatability boundaries', () => {
    const output = compileSdlc(
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
      }),
      piHarnessAdapter,
    );
    const adopt = promptBody(commandAsset(output, 'adopt'));

    for (const phase of [
      'Discovery phase',
      'Classification phase',
      'Proposal phase',
      'Approval phase',
      'Apply phase',
      'Report phase',
    ]) {
      expect(adopt).toContain(phase);
    }
    expect(adopt).toContain('Read repository authority and instruction files before other project material');
    expect(adopt).toContain(
      'without executing project code, hooks, task runners, installers, builds, tests, or dependency commands',
    );
    expect(adopt).toContain('never search, fetch, cite, enrich, or stash web content');
    expect(adopt).toContain('this whole-command rule overrides compiled Searchable instructions');
    expect(adopt).toContain('## Adopt capability boundary');
    expect(adopt).toContain('takes precedence over compiled Searchable instructions');
    expect(adopt).toContain('the no-mutation rule also takes precedence over generic capability instructions');
    expect(adopt).toContain('providers read-only until the exact plan is approved');
    expect(adopt).toContain(
      'documentation, instruction files, Neottia configuration, issue records, and design records',
    );
    expect(adopt).toContain('configured issue and document providers when available');
    expect(adopt).toContain('report only remaining drift');
    expect(adopt).toContain('exact plan for each proposed move, merge, archive, provider import, and reference update');
    expect(adopt).toContain('explicit approval of the exact document-operation plan before any mutation');
    expect(adopt).toContain('separate explicit approval for every irreversible deletion');
    expect(adopt).toContain('dedicated non-default branch or isolated workspace');
    expect(adopt).toContain('Never change the default branch');
    expect(adopt).toContain('verify a usable Git remote, credentials, and pull-request provider');
    expect(adopt).toContain('fail closed if a reviewable pull request cannot be created');
    expect(adopt).toContain('Preserve originals until provider imports are verified');
    expect(adopt).toContain(
      'Never modify application source, dependencies, build systems, CI, or project-specific policy',
    );
    expect(adopt).toContain('Use hook-bypassing source-control operations for commit and push');
    expect(adopt).toContain('fresh approval before push');
    expect(adopt).toContain('fresh approval again before creating a draft pull request');
    expect(adopt).toContain('never merge, close, or auto-approve it');
    expect(adopt).toContain('read-only document, reference, provider, and source-control validation evidence');
    expect(adopt).toContain('Never run target-project validation');
    expect(adopt).toContain('Use the Neottia `issue_*` tools as the issue authority');
    expect(adopt).toContain('Use the Neottia `document_*` tools as the document authority');
    expect(adopt).toContain("This command's semantic ID is `adopt`");
    expect(adopt).toContain('Invoke it through the public command `/neottia-adopt`');
    expect(adopt).toContain('The complete public command map is:');
    expect(adopt).toContain('`adopt` means `/neottia-adopt`');
    const checkpointGuide = adopt.split(
      'Translate those IDs before recommending a checkpoint command to the user:',
    )[1]!;
    expect(checkpointGuide.split('\n')[0]).not.toContain('adopt');
  });

  it('preserves existing command approval and read-only recovery boundaries', () => {
    const output = compileSdlc(
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
      }),
      piHarnessAdapter,
    );

    expect(promptBody(commandAsset(output, 'plan'))).toContain(
      'Obtain explicit approval for the proposed scope before Build.',
    );
    expect(promptBody(commandAsset(output, 'build'))).toContain('Use only the scope approved by Plan');
    expect(promptBody(commandAsset(output, 'verify'))).toContain('Release requires successful required checks');
    expect(promptBody(commandAsset(output, 'release'))).toContain('Ask before merge, publication, deployment, tagging');
    expect(promptBody(commandAsset(output, 'continue'))).toContain('stop without invoking it');
    const refresh = promptBody(commandAsset(output, 'refresh'));
    expect(refresh).toContain('without mutating work');
    expect(refresh).not.toContain('invoke `/neottia-adopt`');
  });

  it('compiles optional-capability boundaries only when the lifecycle selects them', () => {
    const commandPrompts = (output: ReturnType<typeof compileSdlc>): readonly FileAsset[] =>
      promptAssets(output).filter((asset) => asset.target.segments.includes('prompts'));

    const disabled = compileSdlc(
      createSdlcCompilerInput(snapshot(), { compilerVersion: '0.0.0', harnessId: 'pi', scope: 'project' }),
      piHarnessAdapter,
    );
    for (const asset of commandPrompts(disabled)) {
      expect(asset.content).toContain('No memory capability is enabled.');
      expect(asset.content).not.toContain('memory_*` tools as the durable memory authority');
    }
    expect(disabled.commands.every((command) => command.instructionPackIds.includes('neottia.memory.none'))).toBe(true);

    const enabled = compileSdlc(
      createSdlcCompilerInput(
        snapshot({
          memory: { enabled: true },
          searchable: { enabled: true },
          'sdlc-memory-capability': { provider: 'filesystem' },
          'sdlc-searchable-capability': { provider: 'web' },
        }),
        { compilerVersion: '0.0.0', harnessId: 'pi', scope: 'project' },
      ),
      piHarnessAdapter,
    );
    for (const asset of commandPrompts(enabled)) {
      expect(asset.content).toContain('Use the Neottia `memory_*` tools as the durable memory authority.');
      expect(asset.content).toContain('Retrieval is read-only');
      expect(asset.content).toContain('Use the Neottia `web_*` tools as the web-retrieval authority.');
      expect(asset.content).toContain(
        'Local Ollama enrichment runs only where the searchable configuration enables it',
      );
    }
    const enabledAdopt = promptBody(commandAsset(enabled, 'adopt'));
    expect(enabledAdopt).toContain('never search, fetch, cite, enrich, or stash web content');
    expect(enabledAdopt).toContain('whole-command rule takes precedence over compiled Searchable instructions');
    expect(enabled.commands.every((command) => command.instructionPackIds.includes('neottia.memory.durable'))).toBe(
      true,
    );
    expect(enabled.commands.some((command) => command.instructionPackIds.includes('neottia.memory.none'))).toBe(false);
    expect(enabled.commands.some((command) => command.instructionPackIds.includes('neottia.searchable.none'))).toBe(
      false,
    );
  });

  it('rejects command overrides that drop a capability boundary fragment', () => {
    const overrideLayer = {
      tier: 'project' as const,
      sourceId: 'project-override',
      version: '0.0.0',
      files: [
        {
          id: 'neottia.sdlc.command.plan',
          content:
            '{% extends "neottia.sdlc.layout" %}\n{% block title %}Plan{% endblock %}\n{% block purpose %}Override.{% endblock %}\n{% block sequence %}1. Override.{% endblock %}\n{% block memory_instructions %}{% endblock %}\n{% block remote_source_control_instructions %}{% endblock %}\n',
        },
      ],
    };
    expect(() =>
      createSdlcCompilerInput(
        snapshot({ memory: { enabled: true }, 'sdlc-memory-capability': { provider: 'filesystem' } }),
        {
          compilerVersion: '0.0.0',
          harnessId: 'pi',
          scope: 'project',
          templateLayers: [overrideLayer],
        },
      ),
    ).toThrow(/must render the memory boundary fragment/u);

    const searchableOverride = {
      ...overrideLayer,
      files: [
        {
          id: 'neottia.sdlc.command.plan',
          content:
            '{% extends "neottia.sdlc.layout" %}\n{% block title %}Plan{% endblock %}\n{% block purpose %}Override.{% endblock %}\n{% block sequence %}1. Override.{% endblock %}\n{% block searchable_instructions %}{% endblock %}\n{% block remote_source_control_instructions %}{% endblock %}\n',
        },
      ],
    };
    expect(() =>
      createSdlcCompilerInput(
        snapshot({ searchable: { enabled: true }, 'sdlc-searchable-capability': { provider: 'web' } }),
        {
          compilerVersion: '0.0.0',
          harnessId: 'pi',
          scope: 'project',
          templateLayers: [searchableOverride],
        },
      ),
    ).toThrow(/must render the searchable boundary fragment/u);
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

    expect(pi.commands.find((command) => command.id === 'plan')).toMatchObject({
      id: 'plan',
      approvalPoints: ['Obtain explicit approval for the proposed scope before Build.'],
    });
    expect(promptBody(commandAsset(pi, 'plan'))).toContain(
      'Obtain explicit approval for the proposed scope before Build.',
    );
    expect(pi.commands.map((command) => ({ ...command, target: undefined }))).toEqual(
      opencode.commands.map((command) => ({ ...command, target: undefined })),
    );
    expect(promptAssets(pi).map(promptBody)).toEqual(promptAssets(opencode).map(promptBody));
    expect(promptAssets(pi).map((asset) => asset.target.segments.join('/'))).toEqual([
      '.pi/prompts/neottia-adopt.md',
      '.pi/prompts/neottia-build.md',
      '.pi/prompts/neottia-continue.md',
      '.pi/prompts/neottia-plan.md',
      '.pi/prompts/neottia-refresh.md',
      '.pi/prompts/neottia-release.md',
      '.pi/prompts/neottia-verify.md',
      '.pi/skills/neottia-sdlc/SKILL.md',
    ]);
    expect(promptAssets(opencode).map((asset) => asset.target.segments.join('/'))).toEqual([
      '.opencode/commands/neottia-adopt.md',
      '.opencode/commands/neottia-build.md',
      '.opencode/commands/neottia-continue.md',
      '.opencode/commands/neottia-plan.md',
      '.opencode/commands/neottia-refresh.md',
      '.opencode/commands/neottia-release.md',
      '.opencode/commands/neottia-verify.md',
      '.opencode/skills/neottia-sdlc/SKILL.md',
    ]);
    const skillBody = promptBody(promptAssets(pi).at(-1)!);
    expect(skillBody).toContain('neottia-sdlc:checkpoint');
    expect(skillBody).toContain('`next` stores one supported delivery or recovery semantic command ID');
    expect(skillBody).toContain('`verify` means `/neottia-verify`');
    expect(skillBody).toContain('They do not grant host permissions.');
    expect(pi.assets.assets.filter((asset): asset is HostConfigAsset => asset.kind === 'host-config')).toHaveLength(2);
    expect(
      opencode.assets.assets.filter((asset): asset is HostConfigAsset => asset.kind === 'host-config'),
    ).toHaveLength(2);
    expect(promptAssets(pi).every((asset) => !asset.content.includes('{{neottia.'))).toBe(true);
    const continueBody = promptBody(commandAsset(pi, 'continue'));
    expect(continueBody).toContain("This command's semantic ID is `continue`");
    expect(continueBody).toContain('Invoke it through the public command `/neottia-continue`');
    expect(continueBody).toContain('`verify` means `/neottia-verify`');
    expect(continueBody).toContain("Translate the checkpoint's semantic `next` ID");
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
        runtimePackages,
      }),
      claudeCodeHarnessAdapter,
    );

    expect(claude.commands.map((command) => ({ ...command, target: undefined }))).toEqual(
      pi.commands.map((command) => ({ ...command, target: undefined })),
    );
    expect(promptAssets(claude).map(promptBody)).toEqual(promptAssets(pi).map(promptBody));
    expect(promptAssets(claude).map((asset) => asset.target.segments.join('/'))).toEqual([
      '.claude/commands/neottia-adopt.md',
      '.claude/commands/neottia-build.md',
      '.claude/commands/neottia-continue.md',
      '.claude/commands/neottia-plan.md',
      '.claude/commands/neottia-refresh.md',
      '.claude/commands/neottia-release.md',
      '.claude/commands/neottia-verify.md',
      '.claude/skills/neottia-sdlc/SKILL.md',
    ]);
    const claudeRuntimeAssets = claude.assets.assets.filter(
      (asset): asset is HostConfigAsset => asset.kind === 'host-config',
    );
    expect(claudeRuntimeAssets).toHaveLength(2);
    expect(claudeRuntimeAssets.map((asset) => asset.plan.operations[0])).toEqual([
      expect.objectContaining({
        key: 'neottia-design-docs',
        value: expect.objectContaining({
          command: 'npx',
          args: ['--yes', '--package', '@neottia/design-docs-mcp@0.1.0', 'design-docs-mcp'],
        }),
      }),
      expect.objectContaining({
        key: 'neottia-issues',
        value: expect.objectContaining({
          command: 'npx',
          args: ['--yes', '--package', '@neottia/issues-mcp@0.1.0', 'issues-mcp'],
        }),
      }),
    ]);
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
    const plan = commandAsset(output, 'plan');

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
    const body = (command: SdlcCommandId): string => promptBody(commandAsset(output, command));

    for (const command of ['plan', 'build'] as const) {
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
    const addition = 'Apply the project planning checklist.\n';
    const input = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
      templateLayers: [
        {
          tier: 'project',
          sourceId: 'project-templates',
          version: 'revision-1',
          files: [
            { id: packagedPlan.id, content: override },
            { id: SDLC_PROJECT_APPEND_TEMPLATE_IDS.plan, content: addition },
          ],
        },
      ],
    });
    const output = compileSdlc(input, piHarnessAdapter);
    const plan = commandAsset(output, 'plan');
    const build = commandAsset(output, 'build');

    expect(plan.content).toContain('Turn the reviewed request');
    expect(plan.content).toContain(addition.trim());
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

  it('appends plain project instructions only to their matching commands', () => {
    const unchangedInput = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
    });
    expect(unchangedInput).not.toHaveProperty('projectInstructions');
    expect(promptAssets(compileSdlc(unchangedInput, piHarnessAdapter)).map(promptBody).join('\n')).not.toContain(
      '## Project instructions',
    );

    const adoptContent = 'Keep the approved project document taxonomy.\n';
    const buildContent = 'Keep the implementation inside the approved project boundary.\n{{ instructions.issues }}\n';
    const releaseContent = 'Attach the project release checklist.\n';
    const input = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
      templateLayers: [
        {
          tier: 'project',
          sourceId: 'project-templates',
          version: 'revision-1',
          files: [
            { id: SDLC_PROJECT_APPEND_TEMPLATE_IDS.release, content: releaseContent },
            { id: SDLC_PROJECT_APPEND_TEMPLATE_IDS.adopt, content: adoptContent },
            { id: SDLC_PROJECT_APPEND_TEMPLATE_IDS.build, content: buildContent },
          ],
        },
      ],
    });

    expect(input.projectInstructions?.map((instruction) => instruction.id)).toEqual([
      SDLC_PROJECT_APPEND_TEMPLATE_IDS.adopt,
      SDLC_PROJECT_APPEND_TEMPLATE_IDS.build,
      SDLC_PROJECT_APPEND_TEMPLATE_IDS.release,
    ]);
    const output = compileSdlc(input, piHarnessAdapter);
    const adopt = commandAsset(output, 'adopt');
    const build = commandAsset(output, 'build');
    const release = commandAsset(output, 'release');
    const verify = commandAsset(output, 'verify');

    expect(adopt.content).toContain(adoptContent.trim());
    expect(build.content).toContain('## Project instructions');
    expect(build.content).toContain(buildContent.trim());
    expect(build.content).toContain('{{ instructions.issues }}');
    expect(build.content).toContain('These project instructions are additive.');
    expect(release.content).toContain(releaseContent.trim());
    expect(verify.content).not.toContain('## Project instructions');
    expect(output.commands.find((command) => command.id === 'build')?.projectInstructionId).toBe(
      SDLC_PROJECT_APPEND_TEMPLATE_IDS.build,
    );
    expect(output.commands.find((command) => command.id === 'verify')?.projectInstructionId).toBeUndefined();
    expect(output.commands.find((command) => command.id === 'adopt')?.projectInstructionId).toBe(
      SDLC_PROJECT_APPEND_TEMPLATE_IDS.adopt,
    );
    expect(output.assets.templates.map((template) => template.id)).toContain(SDLC_PROJECT_APPEND_TEMPLATE_IDS.build);
  });

  it('rejects invalid project instructions before projection', () => {
    expect(() =>
      createSdlcCompilerInput(snapshot(), {
        compilerVersion: '0.1.0',
        harnessId: 'pi',
        scope: 'project',
        templateLayers: [
          {
            tier: 'project',
            sourceId: 'project-templates',
            version: 'revision-1',
            files: [{ id: SDLC_PROJECT_APPEND_TEMPLATE_IDS.plan, content: 'x'.repeat(256 * 1024 + 1) }],
          },
        ],
      }),
    ).toThrow('exceeds its byte limit');

    const valid = createSdlcCompilerInput(snapshot(), {
      compilerVersion: '0.1.0',
      harnessId: 'pi',
      scope: 'project',
    });
    const unknown = {
      ...valid.templates[0]!,
      id: 'neottia.sdlc.append.deploy',
      content: 'Unknown command.\n',
      checksum: checksumText('Unknown command.\n'),
    };
    expect(() => compileSdlc(resignCompilerInput(valid, { projectInstructions: [unknown] }), piHarnessAdapter)).toThrow(
      'unknown or duplicate command',
    );
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
    expect(promptBody(commandAsset(output, 'plan'))).toContain('Portable role: planner.');
    expect(promptBody(commandAsset(output, 'continue'))).toContain('Portable role: planner.');
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
    const plan = promptBody(commandAsset(output, 'plan'));

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
        `template ${changedTemplate.id} checksum does not match`,
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
