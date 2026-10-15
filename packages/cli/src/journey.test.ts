import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DesignDocumentStore, loadDesignDocsConfig } from '@neottia/design-docs';
import { validateReceipt, type InstallationPlan, type InstallationReceipt } from '@neottia/distribution';
import { IssueStore, loadIssueConfig } from '@neottia/issues';
import { loadMemoryConfig, MemoryStore } from '@neottia/memory-core';
import { loadSearchableConfig, SearchableStore } from '@neottia/searchable-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RUNTIME_PACKAGE_CATALOG } from './catalog.js';
import { main } from './index.js';

/* Forces one incompatible catalog entry for the in-process failure case only;
 * spawned CLI children keep the real shipped catalog. */
const catalogGap = vi.hoisted(() => ({ harness: '' }));
vi.mock('./catalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./catalog.js')>();
  return {
    ...actual,
    catalogEntry: (harnessId: string, logicalId: Parameters<typeof actual.catalogEntry>[1]) =>
      catalogGap.harness === harnessId ? undefined : actual.catalogEntry(harnessId, logicalId),
  };
});

/** Absolute path of the built CLI entrypoint used as the public journey surface. */
const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

/** Disposable roots created by the running tests, removed after each test. */
const temporaryRoots: string[] = [];

/** Canonical command order compiled for every harness. */
const COMMANDS = ['plan', 'build', 'verify', 'release', 'continue', 'refresh'] as const;

/** Expected exact Pi package entries for the enabled modules, from the shipped catalog. */
function expectedPiPackages(enabled: readonly string[] = ['issues', 'design-docs']): readonly string[] {
  const names: Record<string, string> = {
    issues: '@neottia/pi-issues',
    'design-docs': '@neottia/pi-design-docs',
    memory: '@neottia/pi-memory',
    searchable: '@neottia/pi-searchable',
  };
  return enabled.map((logicalId) => {
    const entry = RUNTIME_PACKAGE_CATALOG.pi.find((candidate) => candidate.logicalId === logicalId);
    if (entry === undefined) throw new Error(`Catalog is missing the ${logicalId} runtime package.`);
    return `npm:${names[logicalId]}@${entry.version}`;
  });
}

interface JourneyRoots {
  readonly root: string;
  readonly project: string;
  readonly home: string;
  readonly xdgConfig: string;
  readonly xdgState: string;
}

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the built CLI with fully disposable project, home, and XDG roots. */
function runCli(
  arguments_: readonly string[],
  roots: JourneyRoots,
  overrides: { readonly PATH?: string } = {},
): CliResult {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...arguments_], {
    cwd: roots.project,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: roots.home,
      XDG_CONFIG_HOME: roots.xdgConfig,
      XDG_STATE_HOME: roots.xdgState,
      ...(overrides.PATH === undefined ? {} : { PATH: overrides.PATH }),
    },
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Creates one disposable root set with isolated home and XDG directories. */
async function createRoots(name: string): Promise<JourneyRoots> {
  const root = await mkdtemp(join(tmpdir(), `neottia-cli-journey-${name}-`));
  temporaryRoots.push(root);
  const [project, home, xdgConfig, xdgState] = ['project', 'home', 'xdg-config', 'xdg-state'].map((segment) =>
    join(root, segment),
  );
  for (const path of [project, home, xdgConfig, xdgState]) await mkdir(path, { recursive: true });
  return { root, project, home, xdgConfig, xdgState };
}

/** Lists every file below one root as sorted relative slash-separated paths. */
async function listRelativeFiles(root: string, prefix = ''): Promise<readonly string[]> {
  const base = prefix === '' ? root : join(root, prefix);
  const paths: string[] = [];
  for (const entry of (await readdir(base, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...(await listRelativeFiles(root, relative)));
    else paths.push(relative);
  }
  return paths;
}

/** Removes every disposable root after each journey. */
afterEach(async () => {
  catalogGap.harness = '';
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('empty-project CLI adoption journey (issue #161)', () => {
  it('rejects an unsupported preset before writing anything', async () => {
    const roots = await createRoots('preset');
    const result = runCli(['init', '--harness', 'pi', '--preset', 'turbo'], roots);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Unsupported preset: turbo. Expected: local.');
    expect(existsSync(join(roots.project, '.neottia'))).toBe(false);
  });

  it('fails closed when planning without a configuration', async () => {
    const roots = await createRoots('plan-without-config');
    const result = runCli(['sdlc', 'plan', '--harness', 'pi', '--output', join(roots.root, 'plan.json')], roots);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Run neottia init first. Missing project configuration.');
  });

  it('reports missing host prerequisites without installing anything', async () => {
    const roots = await createRoots('doctor-missing');
    expect(runCli(['init', '--harness', 'pi'], roots).code).toBe(0);
    const manifestPath = join(roots.root, 'manifest.json');
    const planned = runCli(['sdlc', 'plan', '--harness', 'pi', '--manifest', manifestPath], roots);
    expect(planned.code).toBe(0);

    // An empty PATH hides every tool, including Git, from the doctor probes.
    const missing = runCli(['doctor', '--manifest', manifestPath], roots, { PATH: '' });
    expect(missing.code).toBe(2);
    const results = JSON.parse(missing.stdout) as ReadonlyArray<{
      readonly id: string;
      readonly status: string;
      readonly instructions?: string;
    }>;
    const gitCheck = results.find((result) => result.id === 'tool.git');
    expect(gitCheck?.status).toBe('error');
    expect(gitCheck?.instructions).toContain('Install git');
    // The doctor changed nothing in the target.
    expect(await listRelativeFiles(roots.project)).toEqual(['.neottia/config.yml']);
  }, 60000);

  it('fails closed on an incompatible runtime package catalog entry', async () => {
    const roots = await createRoots('catalog-gap');
    expect(runCli(['init', '--harness', 'pi', '--enable', 'memory'], roots).code).toBe(0);
    catalogGap.harness = 'pi';
    const logs: string[] = [];
    const errors: string[] = [];
    const code = await main(['apply', '--project', roots.project], {
      log: (message: string) => void logs.push(message),
      error: (message: string) => void errors.push(message),
    });
    expect(code).toBe(1);
    // Memory is the first catalog candidate, so the gap surfaces there.
    expect(errors).toEqual(['No compatible runtime package for pi memory.']);
    expect(existsSync(join(roots.project, '.pi'))).toBe(false);
  }, 30000);

  it('refuses tampered plans without partial mutation', async () => {
    const roots = await createRoots('tampered');
    expect(runCli(['init', '--harness', 'pi'], roots).code).toBe(0);
    const planPath = join(roots.root, 'plan.json');
    expect(runCli(['sdlc', 'plan', '--harness', 'pi', '--output', planPath], roots).code).toBe(0);

    const plan = JSON.parse(await readFile(planPath, 'utf8')) as { mutations: { content?: string }[] };
    const first = plan.mutations[0]!;
    expect(typeof first.content).toBe('string');
    await writeFile(
      planPath,
      `${JSON.stringify({ ...plan, mutations: [{ ...first, content: `${first.content}x` }] })}`,
      'utf8',
    );

    const applied = runCli(['apply', '--plan', planPath], roots);
    expect(applied.code).toBe(1);
    expect(applied.stderr).toContain('Installation plan digest does not match.');
    expect(existsSync(join(roots.project, '.pi'))).toBe(false);
  }, 60000);

  it('refuses plans with unapproved conflicts and leaves the target untouched', async () => {
    const roots = await createRoots('conflict');
    expect(runCli(['init', '--harness', 'pi'], roots).code).toBe(0);
    const contested = join(roots.project, '.pi', 'prompts', 'build.md');
    await mkdir(dirname(contested), { recursive: true });
    await writeFile(contested, 'user-owned\n', 'utf8');
    const planPath = join(roots.root, 'plan.json');
    const planned = runCli(['sdlc', 'plan', '--harness', 'pi', '--output', planPath], roots);
    expect(planned.code).toBe(2);
    expect(planned.stderr).toContain('conflict');

    const plan = JSON.parse(await readFile(planPath, 'utf8')) as InstallationPlan;
    expect(plan.conflicts.length).toBeGreaterThan(0);
    const applied = runCli(['apply', '--plan', planPath], roots);
    expect(applied.code).toBe(1);
    expect(applied.stderr).toContain('unapproved conflict');
    expect(await readFile(contested, 'utf8')).toBe('user-owned\n');
    expect(existsSync(join(roots.project, '.pi', 'prompts', 'plan.md'))).toBe(false);
  }, 60000);

  it('completes the empty-project adoption journey through the public CLI', async () => {
    const roots = await createRoots('journey');

    // Initialize the project configuration with the local preset.
    expect(runCli(['init', '--harness', 'pi', '--preset', 'local'], roots)).toMatchObject({ code: 0, stderr: '' });
    const configPath = join(roots.project, '.neottia', 'config.yml');
    expect(await readFile(configPath, 'utf8')).toContain('id: pi');

    // Re-running init without --harness validates the existing configuration.
    const validated = runCli(['init', '--project', roots.project], roots);
    expect(validated.code).toBe(0);
    expect(validated.stdout).toContain(`Validated ${configPath}`);

    // Doctor reports the missing install before anything is written.
    const doctorBefore = runCli(['doctor', '--project', roots.project], roots);
    expect(doctorBefore.code).toBe(2);
    expect(doctorBefore.stderr).toContain('pi lifecycle is not installed. Run neottia apply.');
    expect(existsSync(join(roots.project, '.pi'))).toBe(false);

    // Plan the installation and save both reviewable artifacts.
    const planPath = join(roots.root, 'install.plan.json');
    const manifestPath = join(roots.root, 'install.manifest.json');
    const planned = runCli(
      ['sdlc', 'plan', '--harness', 'pi', '--output', planPath, '--manifest', manifestPath],
      roots,
    );
    expect(planned.code).toBe(0);
    expect(planned.stdout).toContain('Plan install.sdlc-pi: 9 mutation(s), 0 conflict(s).');
    expect(planned.stdout).toContain('Restart Pi');

    const plan = JSON.parse(await readFile(planPath, 'utf8')) as InstallationPlan;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ManifestShape;
    expect(plan.id).toBe('install.sdlc-pi');
    expect(plan.action).toBe('install');
    expect(plan.conflicts).toEqual([]);
    expect(plan.reloadNotice?.message).toContain('Restart Pi');

    // The manifest carries prerequisites and per-asset provenance.
    expect(manifest.producer.name).toBe('@neottia/sdlc');
    expect(manifest.harnessId).toBe('pi');
    expect(manifest.scope).toBe('project');
    expect(
      manifest.prerequisites.some(
        (prerequisite) => prerequisite.id === 'tool.git' && prerequisite.check.kind === 'command',
      ),
    ).toBe(true);
    const fileAssets = manifest.assets.filter((asset) => asset.kind === 'file');
    expect(fileAssets).toHaveLength(7);
    for (const asset of fileAssets) {
      expect(asset.source.kind).toBeDefined();
      expect(asset.source.id).toBeDefined();
      expect(asset.source.version).toMatch(/^\d+\.\d+\.\d+$/u);
      expect(asset.checksum).toMatch(/^sha256:[0-9a-f]{64}$/u);
    }
    expect(manifest.assets.some((asset) => asset.kind === 'host-config' && asset.id === 'sdlc.runtime.issues')).toBe(
      true,
    );
    expect(
      manifest.assets.some((asset) => asset.kind === 'host-config' && asset.id === 'sdlc.runtime.design-docs'),
    ).toBe(true);

    // The saved plan mutates exactly: six commands, one skill, one host
    // configuration, and the receipt.
    expect(plan.mutations).toHaveLength(9);
    const fileWrites = plan.mutations.filter((mutation) => mutation.role === 'asset');
    expect(fileWrites).toHaveLength(7);
    for (const command of COMMANDS) {
      expect(fileWrites.some((mutation) => mutation.path.endsWith(join('.pi', 'prompts', `${command}.md`)))).toBe(true);
    }
    const hostWrites = plan.mutations.filter((mutation) => mutation.role === 'host-config');
    expect(hostWrites).toHaveLength(1);
    expect(hostWrites[0]!.path).toBe(join(roots.project, '.pi', 'settings.json'));
    for (const expected of expectedPiPackages()) {
      expect(hostWrites[0]!.content).toContain(expected);
    }

    // Apply the saved plan through the public CLI.
    const applied = runCli(['apply', '--plan', planPath], roots);
    expect(applied.code).toBe(0);
    expect(applied.stdout).toContain('Restart Pi');
    expect(applied.stdout).toContain('"appliedMutations":');

    // Every installed command carries the concrete lifecycle contracts.
    const promptContent = new Map<string, string>();
    for (const command of COMMANDS) {
      const content = await readFile(join(roots.project, '.pi', 'prompts', `${command}.md`), 'utf8');
      promptContent.set(command, content);
      expect(content).toContain('They do not grant host permissions.');
    }
    expect(promptContent.get('plan')).toContain('Obtain explicit approval for the proposed scope before Build.');
    expect(promptContent.get('build')).toContain('Use only the scope approved by Plan');
    expect(promptContent.get('verify')).toContain('Release requires successful required checks');
    expect(promptContent.get('release')).toContain('Ask before merge, publication, deployment, tagging');
    expect(promptContent.get('continue')).toContain('Recommend exactly one supported next public command');
    expect(existsSync(join(roots.project, '.pi', 'skills', 'neottia-sdlc', 'SKILL.md'))).toBe(true);

    // Host configuration carries the exact configured package entries.
    const settings = JSON.parse(await readFile(join(roots.project, '.pi', 'settings.json'), 'utf8')) as {
      packages: string[];
    };
    expect(new Set(settings.packages)).toEqual(new Set(expectedPiPackages()));

    // The receipt is valid, owns every installed unit, and nothing else.
    const receiptPath = join(roots.project, '.neottia', 'install', 'sdlc-pi.receipt.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as InstallationReceipt;
    validateReceipt(receipt);
    expect(receipt.installationId).toBe('sdlc-pi');
    expect(receipt.entries).toHaveLength(9);
    const receiptTargets = receipt.entries.map((entry) => entry.target.segments.join('/'));
    for (const command of COMMANDS) expect(receiptTargets).toContain(`.pi/prompts/${command}.md`);
    expect(receiptTargets).toContain('.pi/skills/neottia-sdlc/SKILL.md');
    expect(receiptTargets).toContain('.pi/settings.json');

    // The target contains exactly the receipt-owned files plus the
    // user-authored configuration, and nothing else.
    expect(await listRelativeFiles(roots.project)).toEqual(
      [
        '.neottia/config.yml',
        '.neottia/install/sdlc-pi.receipt.json',
        ...COMMANDS.map((command) => `.pi/prompts/${command}.md`),
        '.pi/settings.json',
        '.pi/skills/neottia-sdlc/SKILL.md',
      ].sort(),
    );

    // A second identical plan is a no-op update: receipt bytes never change.
    const receiptBytes = await readFile(receiptPath, 'utf8');
    const secondPlanPath = join(roots.root, 'second.plan.json');
    const secondPlan = runCli(['sdlc', 'plan', '--harness', 'pi', '--output', secondPlanPath], roots);
    expect(secondPlan.code).toBe(0);
    expect(secondPlan.stdout).toContain('Plan update.sdlc-pi: 0 mutation(s), 0 conflict(s).');
    expect(runCli(['apply', '--plan', secondPlanPath], roots).code).toBe(0);
    expect(await readFile(receiptPath, 'utf8')).toBe(receiptBytes);

    // A supported configuration change produces a bounded update plan.
    const overrides = join(roots.project, '.neottia', 'templates', 'sdlc');
    await mkdir(overrides, { recursive: true });
    await writeFile(
      join(overrides, 'plan.md.twig'),
      '{% extends "neottia.sdlc.layout" %}\n{% block purpose %}Journey-tailored planning override.{% endblock %}\n',
      'utf8',
    );
    const changedPlanPath = join(roots.root, 'changed.plan.json');
    const changed = runCli(['sdlc', 'plan', '--harness', 'pi', '--output', changedPlanPath], roots);
    expect(changed.code).toBe(0);
    const changedPlan = JSON.parse(await readFile(changedPlanPath, 'utf8')) as InstallationPlan;
    expect(changedPlan.id).toBe('update.sdlc-pi');
    expect(changedPlan.mutations.some((mutation) => mutation.path.endsWith(join('.pi', 'prompts', 'plan.md')))).toBe(
      true,
    );
    expect(changedPlan.mutations.every((mutation) => mutation.role === 'asset' || mutation.role === 'receipt')).toBe(
      true,
    );
    expect(runCli(['apply', '--plan', changedPlanPath], roots).code).toBe(0);
    expect(await readFile(join(roots.project, '.pi', 'prompts', 'plan.md'), 'utf8')).toContain(
      'Journey-tailored planning override.',
    );

    // Doctor reports a healthy static configuration without side effects.
    const doctorAfter = runCli(['doctor', '--project', roots.project], roots);
    expect(doctorAfter.code).toBe(0);
    expect(doctorAfter.stdout).toContain('No missing modules or installs detected.');

    // The deterministic lifecycle fixtures exercise the installed contract:
    // one owning Epic, approved Plan evidence, bounded Build evidence, a
    // Verify defect returned to Build, and Release stopping before merge.
    const issues = new IssueStore(loadIssueConfig(roots.project, { env: {} }), roots.project);
    const documents = await DesignDocumentStore.fromConfig(
      loadDesignDocsConfig(roots.project, { env: {} }),
      roots.project,
    );
    const story = await issues.create({
      type: 'story',
      title: 'Adopt the compiled SDLC',
      body: 'Prove the installed runtime configuration agrees with the generated SDLC configuration.',
      created_by: 'journey',
    });
    let document = await documents.create({
      title: 'Adoption journey design',
      kind: 'hld',
      created_by: 'journey',
      body: 'The installed commands carry the concrete lifecycle contracts.',
    });
    document = await documents.transition(document.id, {
      expected_revision: document.revision,
      to: 'review',
      actor: 'journey',
      intent: 'Request design review before Build.',
      evidence: { source: 'caller-attestation', reference: story.id },
    });
    document = await documents.transition(document.id, {
      expected_revision: document.revision,
      to: 'approved',
      actor: 'journey-reviewer',
      intent: 'Approve the bounded design for Build.',
      evidence: { source: 'caller-attestation', reference: `${story.id}:plan-approved` },
    });
    expect(document.status).toBe('approved');
    expect(existsSync(join(roots.project, '.neottia', 'issues'))).toBe(true);
    expect(existsSync(join(roots.project, '.neottia', 'design-docs'))).toBe(true);

    const epic = await issues.create({
      type: 'epic',
      title: 'Own the adoption lifecycle',
      body: 'The single owning Epic carrying the operating-protocol checkpoints.',
      created_by: 'journey',
    });
    const checkpoint = (phase: string, step: string, status: string, evidence: string, next: string): string =>
      [
        '<!-- neottia-sdlc:checkpoint',
        `phase: ${phase}`,
        `step: ${step}`,
        `status: ${status}`,
        `evidence: ${evidence}`,
        `next: ${next}`,
        '-->',
      ].join('\n');
    const planCheckpoint = await issues.comment(
      epic.id,
      'journey-planner',
      checkpoint('plan', 'P-1', 'completed', `document ${document.id}`, 'build'),
      epic.revision,
    );
    expect(planCheckpoint.comments.at(-1)?.body).toContain('phase: plan');
    const buildCheckpoint = await issues.comment(
      epic.id,
      'journey-implementer',
      checkpoint('build', story.id, 'blocked', 'verify returned defect evidence', 'same-phase step'),
      planCheckpoint.revision,
    );
    expect(buildCheckpoint.comments.at(-1)?.body).toContain('status: blocked');
    const releaseGuard = await issues.comment(
      epic.id,
      'journey-release-coordinator',
      'Release stopped before merge: verification approval is absent.',
      buildCheckpoint.revision,
    );
    expect(releaseGuard.comments.at(-1)?.body).toContain('Release stopped before merge');
    // Stale revisions fail closed instead of overwriting durable evidence.
    await expect(issues.comment(epic.id, 'journey', 'stale write', 'v1:' + '0'.repeat(64))).rejects.toThrow(
      /Stale issue revision/u,
    );

    // Uninstall is receipt-driven and preserves unrelated user-owned
    // host configuration.
    const settingsPath = join(roots.project, '.pi', 'settings.json');
    const userSettings = JSON.parse(await readFile(settingsPath, 'utf8')) as { packages: string[] };
    userSettings.packages.push('npm:@acme/widget@1.0.0');
    await writeFile(settingsPath, `${JSON.stringify(userSettings, null, 2)}\n`, 'utf8');
    const userPrompt = join(roots.project, '.pi', 'prompts', 'keep-me.md');
    await writeFile(userPrompt, 'user-owned\n', 'utf8');

    const uninstallPlanPath = join(roots.root, 'uninstall.plan.json');
    const uninstallPlan = runCli(['uninstall', '--receipt', receiptPath, '--output', uninstallPlanPath], roots);
    expect(uninstallPlan.code).toBe(0);
    expect(runCli(['apply', '--plan', uninstallPlanPath], roots).code).toBe(0);

    for (const command of COMMANDS) {
      expect(existsSync(join(roots.project, '.pi', 'prompts', `${command}.md`))).toBe(false);
    }
    expect(existsSync(join(roots.project, '.pi', 'skills', 'neottia-sdlc', 'SKILL.md'))).toBe(false);
    expect(await readFile(userPrompt, 'utf8')).toBe('user-owned\n');
    const afterUninstall = JSON.parse(await readFile(settingsPath, 'utf8')) as { packages: string[] };
    expect(afterUninstall.packages).toEqual(['npm:@acme/widget@1.0.0']);
    expect(existsSync(receiptPath)).toBe(false);
    expect(existsSync(join(roots.project, '.neottia', 'config.yml'))).toBe(true);
  }, 180000);

  it('integrates Memory into the lifecycle only when explicitly opted in', async () => {
    const roots = await createRoots('memory-journey');

    // Opt-in initialization enables the module and its capability provider.
    expect(runCli(['init', '--harness', 'pi', '--enable', 'memory'], roots)).toMatchObject({ code: 0, stderr: '' });
    const config = await readFile(join(roots.project, '.neottia', 'config.yml'), 'utf8');
    expect(config).toContain('memory:');
    expect(config).toContain('provider: filesystem');

    // Plan and apply carry the exact Memory package entry plus boundaries.
    const planPath = join(roots.root, 'memory.plan.json');
    const planned = runCli(['sdlc', 'plan', '--harness', 'pi', '--output', planPath], roots);
    expect(planned.code).toBe(0);
    expect(planned.stdout).toContain('Plan install.sdlc-pi: 9 mutation(s), 0 conflict(s).');
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as InstallationPlan;
    const hostContent = plan.mutations.find((mutation) => mutation.role === 'host-config')!.content;
    for (const expected of expectedPiPackages(['memory', 'issues', 'design-docs'])) {
      expect(hostContent).toContain(expected);
    }
    expect(runCli(['apply', '--plan', planPath], roots).code).toBe(0);

    // Every compiled command carries retrieval, checkpoint, and shutdown boundaries.
    for (const command of COMMANDS) {
      const content = await readFile(join(roots.project, '.pi', 'prompts', `${command}.md`), 'utf8');
      expect(content).toContain('Use the Neottia `memory_*` tools as the durable memory authority.');
      expect(content).toContain('Retrieve relevant durable memories before planning or resuming work');
      expect(content).toContain('Retrieval is read-only');
      expect(content).toContain('durable outcome summary before a lifecycle run stops');
    }
    const settings = JSON.parse(await readFile(join(roots.project, '.pi', 'settings.json'), 'utf8')) as {
      packages: string[];
    };
    expect(new Set(settings.packages)).toEqual(new Set(expectedPiPackages(['memory', 'issues', 'design-docs'])));

    // The installed runtime package configuration agrees with the Memory module:
    // one store round-trip lands a canonical record under the configured root.
    const memory = MemoryStore.fromConfig(loadMemoryConfig(roots.project, { env: {} }), roots.project);
    try {
      const record = await memory.store({
        memory_type: 'semantic',
        record_type: 'fact',
        topic: 'adoption',
        summary: 'Adopt the compiled SDLC with durable Memory evidence.',
        source: { kind: 'user-confirmed', ref: null, revision: null },
        created_by: 'journey',
        confidence: 'confirmed',
        tags: ['adoption'],
      });
      expect(record.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
      expect(existsSync(join(roots.project, '.neottia', 'memory', 'facts'))).toBe(true);
      expect((await memory.list({ topic: 'adoption' })).map((stored) => stored.id)).toContain(record.id);
    } finally {
      await memory.close();
    }
  }, 120000);

  it('integrates Searchable into the lifecycle only when explicitly opted in', async () => {
    const roots = await createRoots('searchable-journey');

    // Opt-in initialization enables the module and its capability provider.
    expect(runCli(['init', '--harness', 'pi', '--enable', 'searchable'], roots)).toMatchObject({ code: 0, stderr: '' });
    const config = await readFile(join(roots.project, '.neottia', 'config.yml'), 'utf8');
    expect(config).toContain('searchable:');
    expect(config).toContain('provider: web');

    // Plan and apply carry the exact Searchable package entry plus boundaries.
    const planPath = join(roots.root, 'searchable.plan.json');
    const planned = runCli(['sdlc', 'plan', '--harness', 'pi', '--output', planPath], roots);
    expect(planned.code).toBe(0);
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as InstallationPlan;
    const hostContent = plan.mutations.find((mutation) => mutation.role === 'host-config')!.content;
    for (const expected of expectedPiPackages(['searchable', 'issues', 'design-docs'])) {
      expect(hostContent).toContain(expected);
    }
    expect(runCli(['apply', '--plan', planPath], roots).code).toBe(0);

    // Every compiled command carries the web boundaries.
    for (const command of COMMANDS) {
      const content = await readFile(join(roots.project, '.pi', 'prompts', `${command}.md`), 'utf8');
      expect(content).toContain('Use the Neottia `web_*` tools as the web-retrieval authority.');
      expect(content).toContain('record every cited web page as a canonical stash through `web_stash`');
      expect(content).toContain('Local Ollama enrichment runs only where the searchable configuration enables it');
      expect(content).toContain('Web retrieval is read-only');
    }
    const settings = JSON.parse(await readFile(join(roots.project, '.pi', 'settings.json'), 'utf8')) as {
      packages: string[];
    };
    expect(new Set(settings.packages)).toEqual(new Set(expectedPiPackages(['searchable', 'issues', 'design-docs'])));

    // The installed runtime package configuration agrees with the Searchable
    // module: one offline stash and grep round-trip lands a canonical page.
    const store = SearchableStore.fromConfig(
      loadSearchableConfig(roots.project, { enabled: true, env: {} }),
      roots.project,
    );
    try {
      const stashed = await store.stash({
        url: 'https://example.test/adoption-guide',
        title: 'Adoption guide',
        content: 'Deploy the website with pnpm. Verify the status endpoint after each release.',
      });
      expect(stashed.stashed).toBe(true);
      expect(existsSync(join(roots.project, '.neottia', 'searchable', 'pages'))).toBe(true);
      // Direct store calls bypass the tool schema, so the limit is explicit.
      const results = await store.grep({ query: 'status endpoint', limit: 5 });
      expect(results.results.map((result) => result.url)).toContain('https://example.test/adoption-guide');
    } finally {
      await store.close?.();
    }
  }, 120000);
});

/** Compiler manifest shape used by the journey assertions. */
interface ManifestShape {
  readonly installationId: string;
  readonly producer: { readonly name: string; readonly version: string };
  readonly harnessId: string;
  readonly scope: string;
  readonly prerequisites: ReadonlyArray<{
    readonly id: string;
    readonly check: { readonly kind: string; readonly command?: string };
  }>;
  readonly assets: ReadonlyArray<
    | {
        readonly kind: 'file';
        readonly id: string;
        readonly checksum: string;
        readonly source: { readonly kind: string; readonly id: string; readonly version: string };
      }
    | {
        readonly kind: 'host-config';
        readonly id: string;
        readonly source: { readonly kind: string; readonly id: string; readonly version: string };
      }
  >;
  readonly reloadNotice?: { readonly message: string };
}
