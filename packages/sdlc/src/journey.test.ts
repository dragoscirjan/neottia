import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createConfigRegistry, createResolvedConfigSnapshot } from '@neottia/config';
import { DesignDocumentStore, designDocsConfigContribution, loadDesignDocsConfig } from '@neottia/design-docs';
import {
  applyInstallationPlan,
  createInstallationPlan,
  inspectInstallation,
  resolveTarget,
  type InstallRoots,
} from '@neottia/distribution';
import { IssueStore, issueConfigContribution, loadIssueConfig } from '@neottia/issues';
import { afterEach, describe, expect, it } from 'vitest';

import { compileSdlc, createSdlcCompilerInput } from './compiler.js';
import {
  documentsCapabilityConfigContribution,
  issuesCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
} from './config.js';

import { opencodeHarnessAdapter } from '../../../extensions/opencode-adapter/src/index.js';
import { piHarnessAdapter } from '../../../extensions/pi-adapter/src/index.js';

const registry = createConfigRegistry([
  issueConfigContribution,
  designDocsConfigContribution,
  issuesCapabilityConfigContribution,
  documentsCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
]);
const temporaryRoots: string[] = [];
const runtimePackages = [
  { logicalId: 'issues' as const, version: '0.1.0' },
  { logicalId: 'design-docs' as const, version: '0.1.0' },
];

/** Removes every disposable root created by a lifecycle journey. */
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Proves both adapters install the same six commands in both supported scopes. */
describe.each([
  ['pi', piHarnessAdapter],
  ['opencode', opencodeHarnessAdapter],
] as const)('%s compiler projection', (harnessId, adapter) => {
  it.each(['project', 'global'] as const)(
    'installs the canonical %s lifecycle in a temporary project',
    async (scope) => {
      const roots = await createRoots();
      const input = createSdlcCompilerInput(compilerSnapshot(), {
        compilerVersion: '0.1.0',
        harnessId,
        scope,
        runtimePackages,
      });
      const first = compileSdlc(input, adapter);
      const second = compileSdlc(structuredClone(input), adapter);

      expect(first).toEqual(second);
      const plan = createInstallationPlan(await inspectInstallation(first.assets, roots), 'install');
      expect(plan.conflicts).toEqual([]);
      await applyInstallationPlan(plan);

      const promptAssets = first.assets.assets.filter((asset) => asset.kind === 'file');
      expect(promptAssets).toHaveLength(6);
      for (const asset of promptAssets) {
        expect(await readFile(resolveTarget(asset.target, roots), 'utf8')).toContain(
          'They do not grant host permissions.',
        );
      }
      expect(first.assets.assets.filter((asset) => asset.kind === 'host-config')).toHaveLength(2);
    },
  );
});

/** Exercises durable Plan-to-Release evidence with filesystem providers and local Git. */
it('completes a filesystem and local-Git Plan-to-Release journey under one temporary root', async () => {
  const roots = await createRoots();
  await writeProjectConfig(roots.project);

  for (const [harnessId, adapter] of [
    ['pi', piHarnessAdapter],
    ['opencode', opencodeHarnessAdapter],
  ] as const) {
    const input = createSdlcCompilerInput(compilerSnapshot(), {
      compilerVersion: '0.1.0',
      harnessId,
      scope: 'project',
      runtimePackages,
    });
    const output = compileSdlc(input, adapter);
    const plan = createInstallationPlan(await inspectInstallation(output.assets, roots), 'install');
    expect(plan.conflicts).toEqual([]);
    await applyInstallationPlan(plan);
  }

  const issues = new IssueStore(loadIssueConfig(roots.project, { env: {} }), roots.project);
  const documents = await DesignDocumentStore.fromConfig(
    loadDesignDocsConfig(roots.project, { env: {} }),
    roots.project,
  );

  let issue = await issues.create({
    type: 'story',
    title: 'Compile a canonical lifecycle',
    body: 'Preserve equivalent Plan-to-Release evidence for Pi and OpenCode.',
    created_by: 'test-operator',
  });
  let document = await documents.create({
    title: 'Canonical lifecycle design',
    kind: 'hld',
    created_by: 'test-operator',
    body: 'The six commands retain approvals, stop conditions, and permission boundaries.',
  });
  document = await documents.transition(document.id, {
    expected_revision: document.revision,
    to: 'review',
    actor: 'test-operator',
    intent: 'Request design review before Build.',
    evidence: { source: 'caller-attestation', reference: issue.id },
  });
  document = await documents.transition(document.id, {
    expected_revision: document.revision,
    to: 'approved',
    actor: 'test-reviewer',
    intent: 'Approve the bounded design for Build.',
    evidence: { source: 'caller-attestation', reference: `${issue.id}:plan-approved` },
  });
  issue = await issues.comment(
    issue.id,
    'test-reviewer',
    `Plan approved with document ${document.id}.`,
    issue.revision,
  );
  issue = await issues.transition(issue.id, 'in_progress', issue.revision);

  git(roots.project, 'init');
  git(roots.project, 'config', 'user.name', 'Neottia Test');
  git(roots.project, 'config', 'user.email', 'neottia-test@example.invalid');
  await writeFile(join(roots.project, 'implementation.txt'), 'canonical lifecycle implemented\n', 'utf8');
  git(roots.project, 'add', 'implementation.txt');
  git(roots.project, 'commit', '-m', 'feat: implement canonical lifecycle');

  issue = await issues.comment(
    issue.id,
    'test-verifier',
    'Verify passed: compiled manifests are deterministic and both host projections are installed.',
    issue.revision,
  );
  issue = await issues.comment(
    issue.id,
    'test-release-coordinator',
    'Release evidence prepared; no merge, publication, or deployment was authorized.',
    issue.revision,
  );
  issue = await issues.transition(issue.id, 'done', issue.revision);

  expect(issue.status).toBe('done');
  expect((await documents.get(document.id)).status).toBe('approved');
  expect(git(roots.project, 'log', '-1', '--pretty=%s')).toBe('feat: implement canonical lifecycle');
  expect(existsSync(join(roots.project, '.pi', 'prompts', 'release.md'))).toBe(true);
  expect(existsSync(join(roots.project, '.opencode', 'commands', 'release.md'))).toBe(true);
  expect(existsSync(join(roots.project, '.neottia', 'issues'))).toBe(true);
  expect(existsSync(join(roots.project, '.neottia', 'design-docs'))).toBe(true);
});

/** Creates one isolated install root set. */
async function createRoots(): Promise<InstallRoots> {
  const root = await mkdtemp(join(tmpdir(), 'neottia-sdlc-journey-'));
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

/** Creates an immutable compiler snapshot selecting built-in providers. */
function compilerSnapshot() {
  return createResolvedConfigSnapshot(registry, {
    issues: { enabled: true },
    'design-docs': { enabled: true },
  });
}

/** Writes only the canonical store configuration needed by the journey. */
async function writeProjectConfig(project: string): Promise<void> {
  const directory = join(project, '.neottia');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'config.yml'),
    'version: 1\nmodules:\n  issues:\n    enabled: true\n  design_docs:\n    enabled: true\n',
    'utf8',
  );
}

/** Executes isolated local Git without inheriting repository hook state. */
function git(cwd: string, ...args: string[]): string {
  // Git hooks can export GIT_DIR or GIT_WORK_TREE while running this test. Remove
  // every Git override so cwd remains the authority for the disposable repository.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) => !name.startsWith('GIT_') && value !== undefined),
  ) as NodeJS.ProcessEnv;
  return execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
}
