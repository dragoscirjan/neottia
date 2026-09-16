import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { resolveTemplates } from '@neottia/distribution';
import { afterEach, describe, expect, it } from 'vitest';

import { SDLC_LIFECYCLE } from './lifecycle.js';
import { loadPackagedSdlcTemplateLayer, loadSdlcTemplateLayers } from './template-loader.js';

const temporaryRoots: string[] = [];

/** Removes every disposable template root created by these integration tests. */
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SDLC template loader', () => {
  it('loads external command templates, layout, and lifecycle prose without provider syntax', async () => {
    const layer = await loadPackagedSdlcTemplateLayer();

    expect(layer.tier).toBe('packaged');
    expect(layer.files.map((file) => file.id).sort()).toEqual(
      ['neottia.sdlc.layout', 'neottia.sdlc.lifecycle', ...SDLC_LIFECYCLE.map((command) => command.templateId)].sort(),
    );
    const layout = layer.files.find((template) => template.id === 'neottia.sdlc.layout')!;
    const lifecycle = JSON.parse(layer.files.find((template) => template.id === 'neottia.sdlc.lifecycle')!.content) as {
      readonly commands: ReadonlyArray<{ readonly id: string; readonly approvalPoints: readonly string[] }>;
    };
    expect(lifecycle.commands.find((command) => command.id === 'plan')?.approvalPoints).toEqual([
      'Obtain explicit approval for the proposed scope before Build.',
    ]);
    expect(layout.content).toContain('{% for role in roles %}');
    expect(layout.content).toContain('{{ instructions.issues }}');
    expect(layout.content).toContain('They do not grant host permissions.');
    for (const template of layer.files) {
      expect(template.content).not.toMatch(/\b(?:github|gitlab|jira|confluence|filesystem)\b/iu);
    }
  });

  it('resolves project overrides above global and packaged templates', async () => {
    const globalRoot = await temporaryRoot('neottia-sdlc-global-');
    const projectRoot = await temporaryRoot('neottia-sdlc-project-');
    const packaged = await loadPackagedSdlcTemplateLayer();
    const packagedPlan = packaged.files.find((file) => file.id === 'neottia.sdlc.command.plan')!;
    await writeOverride(
      globalRoot,
      'plan.md',
      packagedPlan.content.replace('Turn the request', 'Turn the global request'),
    );
    const projectContent = packagedPlan.content.replace('Turn the request', 'Turn the project request');
    await writeOverride(projectRoot, 'plan.md', projectContent);

    const layers = await loadSdlcTemplateLayers({ globalRoot, projectRoot });
    const templates = resolveTemplates(
      SDLC_LIFECYCLE.map((command) => command.templateId),
      layers,
    );
    const plan = templates.find((template) => template.id === packagedPlan.id)!;

    expect(plan.content).toBe(projectContent);
    expect(plan.sourceId).toBe('neottia-project-sdlc');
    expect(plan.shadowed.map((source) => source.sourceId)).toEqual(['@neottia/sdlc', 'neottia-global-sdlc']);
  });

  it('rejects unknown command filenames instead of ignoring them', async () => {
    const projectRoot = await temporaryRoot('neottia-sdlc-unknown-');
    await writeOverride(projectRoot, 'deploy.md', '# Deploy\n');

    await expect(loadSdlcTemplateLayers({ projectRoot })).rejects.toThrow('Unknown SDLC template filename deploy.md.');
  });

  it('rejects linked override directories before reading templates', async () => {
    const projectRoot = await temporaryRoot('neottia-sdlc-linked-');
    const externalRoot = await temporaryRoot('neottia-sdlc-external-');
    await mkdir(join(projectRoot, '.neottia'), { recursive: true });
    await symlink(externalRoot, join(projectRoot, '.neottia', 'templates'));

    await expect(loadSdlcTemplateLayers({ projectRoot })).rejects.toThrow(
      'SDLC template path must contain only regular directories.',
    );
  });
});

/** Creates and tracks one absolute temporary root. */
async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

/** Writes one conventional project or global override file. */
async function writeOverride(root: string, filename: string, content: string): Promise<void> {
  const path = join(root, '.neottia', 'templates', 'sdlc', filename);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}
