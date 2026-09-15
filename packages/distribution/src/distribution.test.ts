import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { HarnessAdapter, HarnessScope } from '@neottia/harness-adapter';
import { opencodeHarnessAdapter } from '@neottia/opencode-adapter';
import { piHarnessAdapter } from '@neottia/pi-adapter';

import { afterEach, describe, expect, it } from 'vitest';

import { runDoctor } from './doctor.js';
import { inspectInstallation, inspectUninstall } from './inspection.js';
import {
  checksumBytes,
  checksumText,
  createAssetManifest,
  createAssetSource,
  fileAssetFromProjection,
  journalPath,
  receiptPath,
  resolveTarget,
} from './manifest.js';
import { authorizePlan, createInstallationPlan } from './planner.js';
import { externalSkillIntegrity, resolveSkillsBin, stageExternalSkills } from './skills.js';
import { loadTemplateLayer } from './templates.js';
import { applyInstallationPlan, recoverInstallation } from './transaction.js';
import type { AssetManifest, FileAsset, InstallRoots } from './types.js';

const temporaryRoots: string[] = [];
const source = createAssetSource({ kind: 'generated', id: 'compiler', version: '1.0.0', content: 'compiler' });

/** Removes every disposable project after each integration scenario. */
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** Exercises both adapters in both supported scopes without touching the checkout or real home. */
describe.each([
  ['pi', piHarnessAdapter],
  ['opencode', opencodeHarnessAdapter],
] as const)('%s installation', (_host, adapter) => {
  it.each(['project', 'global'] as const)('installs, updates, and uninstalls %s assets', async (scope) => {
    const roots = await createRoots();
    const manifest = manifestFor(adapter, scope);
    const prompt = manifest.assets.find((asset) => asset.kind === 'file') as FileAsset;
    const target = resolveTarget(prompt.target, roots);

    const install = createInstallationPlan(await inspectInstallation(manifest, roots), 'install');
    expect(install.conflicts).toEqual([]);
    await applyInstallationPlan(install);
    expect(await readFile(target, 'utf8')).toContain('Plan the work.');

    const update = createInstallationPlan(await inspectInstallation(manifest, roots), 'update');
    expect(update.mutations).toEqual([]);

    const receipt = receiptPath(manifest.installationId, scope, roots);
    const uninstall = createInstallationPlan(await inspectUninstall(receipt, roots), 'uninstall');
    expect(uninstall.conflicts).toEqual([]);
    await applyInstallationPlan(uninstall);
    await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('transaction and staging integration', () => {
  it('reports instructions for missing tools, packages, MCP servers, and configuration', async () => {
    const roots = await createRoots();
    const manifest = createAssetManifest({
      installationId: 'doctor',
      producer: { name: '@neottia/test', version: '1.0.0' },
      harnessId: 'test',
      scope: 'project',
      configChecksum: checksumText('{}\n'),
      templates: [],
      assets: [],
      prerequisites: [
        {
          id: 'tool',
          category: 'tool',
          description: 'Required tool',
          check: { kind: 'command', command: 'missing-neottia-tool' },
          instructions: 'Install the required tool.',
        },
        {
          id: 'package',
          category: 'package',
          description: 'Required package',
          check: { kind: 'package', packageName: 'missing-neottia-package' },
          instructions: 'Add the required package.',
        },
        {
          id: 'mcp',
          category: 'mcp-server',
          description: 'Required MCP server',
          check: { kind: 'command', command: 'missing-neottia-mcp' },
          instructions: 'Configure the MCP server.',
        },
        {
          id: 'config',
          category: 'configuration',
          description: 'Required configuration',
          check: { kind: 'environment', variable: 'MISSING_NEOTTIA_CONFIG' },
          instructions: 'Set the required configuration.',
        },
      ],
    });

    const results = await runDoctor(manifest, roots, { PATH: '' });
    expect(results).toHaveLength(4);
    expect(results.every((result) => result.status === 'error' && result.instructions !== undefined)).toBe(true);
  });

  it('loads explicit template manifests and verifies source checksums', async () => {
    const roots = await createRoots();
    const template = 'Plan from package.\n';
    const manifestPath = join(roots.project, 'template-pack', 'neottia.templates.json');
    await mkdir(join(roots.project, 'template-pack', 'commands'), { recursive: true });
    await writeFile(join(roots.project, 'template-pack', 'commands', 'plan.md'), template);
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        templates: {
          'neottia.command.plan': { file: 'commands/plan.md', checksum: checksumText(template) },
        },
      }),
    );

    const layer = await loadTemplateLayer({
      tier: 'package',
      sourceId: 'team-templates',
      version: '1.0.0',
      manifestPath,
    });
    expect(layer.files).toEqual([{ id: 'neottia.command.plan', content: template }]);
  });

  it('rejects symbolic links in template source path components', async () => {
    const roots = await createRoots();
    const template = 'Outside template.\n';
    const outside = join(dirname(roots.project), 'outside-template');
    const templateRoot = join(roots.project, 'template-pack');
    const manifestPath = join(templateRoot, 'neottia.templates.json');
    await mkdir(outside);
    await mkdir(templateRoot);
    await writeFile(join(outside, 'plan.md'), template);
    await symlink(outside, join(templateRoot, 'commands'));
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        templates: {
          'neottia.command.plan': { file: 'commands/plan.md', checksum: checksumText(template) },
        },
      }),
    );

    await expect(
      loadTemplateLayer({
        tier: 'package',
        sourceId: 'linked-templates',
        version: '1.0.0',
        manifestPath,
      }),
    ).rejects.toThrow('escapes its manifest directory');
  });

  it('recovers an interrupted transaction from its durable before-state', async () => {
    const roots = await createRoots();
    const recoveryReceipt = join(roots.xdgState, 'neottia', 'receipts', 'recover.json');
    const target = join(roots.project, 'recover.txt');
    const recoveryJournal = journalPath(recoveryReceipt);
    const before = 'before\n';
    const after = 'after\n';
    await mkdir(join(roots.xdgState, 'neottia', 'receipts'), { recursive: true });
    await writeFile(target, after);
    await writeFile(
      recoveryJournal,
      JSON.stringify({
        schemaVersion: 1,
        state: 'active',
        planDigest: checksumText('plan'),
        entries: [
          {
            path: target,
            root: roots.project,
            before: {
              exists: true,
              encoding: 'base64',
              checksum: checksumText(before),
              content: Buffer.from(before).toString('base64'),
            },
            after: { exists: true, checksum: checksumText(after) },
          },
        ],
      }),
    );

    expect(await recoverInstallation(recoveryReceipt)).toBe('rolled-back');
    expect(await readFile(target, 'utf8')).toBe(before);
    await expect(lstat(recoveryJournal)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores every published file when a later mutation fails', async () => {
    const roots = await createRoots();
    const manifest = createAssetManifest({
      installationId: 'rollback',
      producer: { name: '@neottia/test', version: '1.0.0' },
      harnessId: 'test',
      scope: 'project',
      configChecksum: checksumText('{}\n'),
      templates: [],
      prerequisites: [],
      assets: [fileAsset('one', 'one.txt'), fileAsset('two', 'two.txt')],
    });
    const plan = createInstallationPlan(await inspectInstallation(manifest, roots), 'install');

    await expect(
      applyInstallationPlan(plan, {
        beforeMutation(index) {
          if (index === 1) throw new Error('injected failure');
        },
      }),
    ).rejects.toThrow('injected failure');
    await expect(readFile(join(roots.project, 'one.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(roots.project, 'two.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the skills package only in staging and projects every regular file through the adapter', async () => {
    expect((await lstat(resolveSkillsBin())).isFile()).toBe(true);
    const roots = await createRoots();
    const fakeBin = join(roots.project, 'fake-skills.mjs');
    await writeFile(
      fakeBin,
      [
        "import { mkdir, writeFile } from 'node:fs/promises';",
        "import { join } from 'node:path';",
        "const index = process.argv.indexOf('--skill');",
        'const skill = process.argv[index + 1];',
        "const root = join(process.cwd(), '.agents', 'skills', skill);",
        "await mkdir(join(root, 'references'), { recursive: true });",
        "await writeFile(join(root, 'SKILL.md'), '# Demo\\n');",
        "await writeFile(join(root, 'references', 'guide.md'), 'Guide.\\n');",
      ].join('\n'),
    );
    const files = [
      { skill: 'demo', relativePath: 'SKILL.md', bytes: Buffer.from('# Demo\n') },
      { skill: 'demo', relativePath: 'references/guide.md', bytes: Buffer.from('Guide.\n') },
    ];
    const assets = await stageExternalSkills({
      skillsBin: fakeBin,
      adapter: piHarnessAdapter,
      request: {
        id: 'demo-source',
        source: 'local-fixture',
        revision: 'commit-123',
        integrity: externalSkillIntegrity(files),
        skills: ['demo'],
        scope: 'project',
      },
    });

    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.target.segments.join('/'))).toEqual([
      '.pi/skills/demo/SKILL.md',
      '.pi/skills/demo/references/guide.md',
    ]);

    await expect(
      stageExternalSkills({
        skillsBin: fakeBin,
        adapter: piHarnessAdapter,
        limits: { maxFiles: 10, maxBytes: 1 },
        request: {
          id: 'oversized-source',
          source: 'local-fixture',
          revision: 'commit-123',
          integrity: externalSkillIntegrity(files),
          skills: ['demo'],
          scope: 'project',
        },
      }),
    ).rejects.toThrow('exceeds configured limits');
  });

  it('rejects symbolic-link staged skill roots', async () => {
    const roots = await createRoots();
    const outside = join(dirname(roots.project), 'outside-skill');
    const fakeBin = join(roots.project, 'linked-skills.mjs');
    await mkdir(outside);
    await writeFile(join(outside, 'SKILL.md'), '# Linked\n');
    await writeFile(
      fakeBin,
      [
        "import { mkdir, symlink } from 'node:fs/promises';",
        "import { join } from 'node:path';",
        "const root = join(process.cwd(), '.agents', 'skills');",
        'await mkdir(root, { recursive: true });',
        `await symlink(${JSON.stringify(outside)}, join(root, 'demo'));`,
      ].join('\n'),
    );

    await expect(
      stageExternalSkills({
        skillsBin: fakeBin,
        adapter: piHarnessAdapter,
        request: {
          id: 'linked-source',
          source: 'local-fixture',
          revision: 'commit-123',
          integrity: checksumText('unused'),
          skills: ['demo'],
          scope: 'project',
        },
      }),
    ).rejects.toThrow('cannot contain symbolic links');
  });

  it('rejects symbolic-link ancestors before publishing reviewed paths', async () => {
    const roots = await createRoots();
    const outside = join(dirname(roots.project), 'outside');
    await mkdir(outside);
    await symlink(outside, join(roots.project, '.pi'));
    const plan = createInstallationPlan(
      await inspectInstallation(manifestFor(piHarnessAdapter, 'project'), roots),
      'install',
    );

    await expect(applyInstallationPlan(plan)).rejects.toThrow('unsafe ancestor');
    await expect(lstat(join(outside, 'prompts', 'plan.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('owns one host configuration entry and restores displaced operator data', async () => {
    const roots = await createRoots();
    const configPath = join(roots.project, 'opencode.json');
    await writeFile(
      configPath,
      `${JSON.stringify({ theme: 'dark', plugin: ['@neottia/opencode-issues@9.9.9'] }, null, 2)}\n`,
    );
    const manifest = manifestFor(opencodeHarnessAdapter, 'project');
    const proposed = createInstallationPlan(await inspectInstallation(manifest, roots), 'install');
    expect(proposed.conflicts).toHaveLength(1);
    await applyInstallationPlan(authorizePlan(proposed, [proposed.conflicts[0]!.id]));

    await writeFile(
      configPath,
      `${JSON.stringify({ theme: 'light', plugin: ['@neottia/opencode-issues@1.0.0'] }, null, 2)}\n`,
    );
    const uninstall = createInstallationPlan(
      await inspectUninstall(receiptPath(manifest.installationId, 'project', roots), roots),
      'uninstall',
    );
    expect(uninstall.conflicts).toEqual([]);
    await applyInstallationPlan(uninstall);

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      theme: 'light',
      plugin: ['@neottia/opencode-issues@9.9.9'],
    });
  });

  it('blocks ambiguous OpenCode configuration candidates', async () => {
    const roots = await createRoots();
    await Promise.all([
      writeFile(join(roots.project, 'opencode.json'), '{}\n'),
      writeFile(join(roots.project, 'opencode.jsonc'), '{}\n'),
    ]);
    await expect(inspectInstallation(manifestFor(opencodeHarnessAdapter, 'project'), roots)).rejects.toThrow(
      /more than one host configuration candidate/iu,
    );
  });
});

/** Creates one deterministic prompt and package plan through an injected adapter. */
function manifestFor(adapter: HarnessAdapter, scope: HarnessScope): AssetManifest {
  const prompt = adapter.projectPrompt({ id: 'plan', scope, body: 'Plan the work.\n' });
  const declaredPackage = adapter.declarePackage({ logicalId: 'issues', scope, version: '1.0.0' });
  if (prompt.value === undefined || declaredPackage.value === undefined) throw new TypeError('Adapter fixture failed.');
  const hostPlan = adapter.planHostConfiguration({ kind: 'package', package: declaredPackage.value });
  if (hostPlan.value === undefined) throw new TypeError('Adapter host plan fixture failed.');
  return createAssetManifest({
    installationId: `${adapter.declaration.id}-${scope}`,
    producer: { name: '@neottia/test', version: '1.0.0' },
    harnessId: adapter.declaration.id,
    scope,
    configChecksum: checksumText('{}\n'),
    templates: [],
    prerequisites: [],
    assets: [
      fileAssetFromProjection(prompt.value, source),
      { kind: 'host-config', id: 'host.package.issues', plan: hostPlan.value, source },
    ],
    reloadNotice: adapter.reloadNotice({ changedFeatures: ['asset.prompt', 'config.package'] }).value,
  });
}

/** Creates one test file asset without bypassing checksum validation. */
function fileAsset(id: string, name: string): FileAsset {
  const bytes = Buffer.from(`${id}\n`);
  return {
    kind: 'file',
    id: `file.${id}`,
    target: { anchor: 'project', segments: [name] },
    encoding: 'utf8',
    content: bytes.toString('utf8'),
    checksum: checksumBytes(bytes),
    source,
  };
}

/** Creates isolated project, home, XDG config, and XDG state roots. */
async function createRoots(): Promise<InstallRoots> {
  const root = await mkdtemp(join(tmpdir(), 'neottia-distribution-test-'));
  temporaryRoots.push(root);
  const roots = {
    project: join(root, 'project'),
    home: join(root, 'home'),
    xdgConfig: join(root, 'xdg-config'),
    xdgState: join(root, 'xdg-state'),
  };
  await Promise.all(Object.values(roots).map((path) => mkdir(path, { recursive: true })));
  return roots;
}
