import { targetPath, type HostConfigPlan } from '@neottia/harness-adapter';

import { describe, expect, it } from 'vitest';

import { applyHostUnitStates, operationState, operationUnit, readHostUnit } from './host-config.js';
import {
  canonicalJson,
  checksumText,
  createAssetManifest,
  createAssetSource,
  fileAssetFromProjection,
  validateManifest,
} from './manifest.js';
import { authorizePlan, assertPlanAuthorized, createInstallationPlan } from './planner.js';
import { resolveTemplates } from './templates.js';
import type { InstallationSnapshot } from './types.js';

const source = createAssetSource({ kind: 'generated', id: 'compiler', version: '1.0.0', content: 'compiler' });

/** Covers pure deterministic contracts without touching the filesystem. */
describe('distribution contracts', () => {
  it('resolves all four template tiers with complete-file overrides', () => {
    const resolved = resolveTemplates(
      ['neottia.command.plan'],
      [
        {
          tier: 'project',
          sourceId: 'project',
          version: 'sha256:project',
          files: [{ id: 'neottia.command.plan', content: 'project\n' }],
        },
        {
          tier: 'packaged',
          sourceId: 'builtin',
          version: '1.0.0',
          files: [{ id: 'neottia.command.plan', content: 'builtin\n' }],
        },
        {
          tier: 'global',
          sourceId: 'global',
          version: 'sha256:global',
          files: [{ id: 'neottia.command.plan', content: 'global\n' }],
        },
        {
          tier: 'package',
          sourceId: 'package',
          version: '2.0.0',
          files: [{ id: 'neottia.command.plan', content: 'package\n' }],
        },
      ],
    );

    expect(resolved[0]).toMatchObject({ content: 'project\n', sourceId: 'project' });
    expect(resolved[0]?.shadowed.map((entry) => entry.sourceId)).toEqual(['builtin', 'package', 'global']);
  });

  it('rejects duplicate template IDs at one precedence tier', () => {
    expect(() =>
      resolveTemplates(
        ['same'],
        [
          { tier: 'package', sourceId: 'one', version: '1', files: [{ id: 'same', content: 'one' }] },
          { tier: 'package', sourceId: 'two', version: '1', files: [{ id: 'same', content: 'two' }] },
        ],
      ),
    ).toThrow(/duplicated/u);
  });

  it('preserves unrelated JSONC content while updating owned entries', () => {
    const operation = {
      id: 'package:issues',
      kind: 'ensure-array-entry' as const,
      pointer: '/plugin',
      identity: 'npm:@neottia/opencode-issues',
      value: '@neottia/opencode-issues@2.0.0',
      owner: 'neottia' as const,
    };
    const unit = operationUnit(operation);
    const output = applyHostUnitStates(
      '{\n  // operator setting\n  "theme": "dark",\n  "plugin": ["@neottia/opencode-issues@1.0.0"]\n}\n',
      [{ unit, state: operationState(operation) }],
    );

    expect(output).toContain('// operator setting');
    expect(output).toContain('"theme": "dark"');
    expect(output).toContain('@neottia/opencode-issues@2.0.0');
    expect(readHostUnit(output, unit).checksum).toBe(operationState(operation).checksum);
  });

  it('does not create or rewrite an array for a missing owned entry', () => {
    const content = '{\n  // keep array formatting\n  "plugin": [\n    "operator-plugin"\n  ]\n}\n';
    const unit = {
      kind: 'array-entry' as const,
      pointer: '/plugin',
      identity: 'npm:@neottia/opencode-issues',
    };

    expect(applyHostUnitStates(content, [{ unit, state: { exists: false } }])).toBe(content);
    expect(applyHostUnitStates('{}\n', [{ unit, state: { exists: false } }])).toBe('{}\n');
  });

  it('sorts canonical JSON by code unit instead of the host locale', () => {
    expect(canonicalJson({ a: 4, A: 3, '.': 2, '-': 1 })).toBe('{\n  "-": 1,\n  ".": 2,\n  "A": 3,\n  "a": 4\n}\n');
  });

  it('produces byte-identical manifests for identical inputs', () => {
    const projected = {
      assetId: 'plan',
      feature: 'asset.prompt' as const,
      target: targetPath('project', ['.host', 'plan.md']),
      mediaType: 'text/markdown' as const,
      content: 'Plan.\n',
    };
    const input = {
      installationId: 'default',
      producer: { name: '@neottia/test', version: '1.0.0' },
      harnessId: 'test',
      scope: 'project' as const,
      configChecksum: checksumText('{}\n'),
      templates: [],
      prerequisites: [],
      assets: [fileAssetFromProjection(projected, source)],
    };

    const left = createAssetManifest(input);
    const right = createAssetManifest(structuredClone(input));
    expect(left).toEqual(right);
    expect(() => validateManifest(left)).not.toThrow();
  });

  it('requires an exact approval before adopting an existing file', () => {
    const content = 'existing\n';
    const snapshot: InstallationSnapshot = {
      roots: { project: '/project', home: '/home', xdgConfig: '/config', xdgState: '/state' },
      receiptPath: '/project/.neottia/install/default.receipt.json',
      receiptContainer: { path: '/project/.neottia/install/default.receipt.json', exists: false },
      manifest: createAssetManifest({
        installationId: 'default',
        producer: { name: '@neottia/test', version: '1.0.0' },
        harnessId: 'test',
        scope: 'project',
        configChecksum: checksumText('{}\n'),
        templates: [],
        prerequisites: [],
        assets: [],
      }),
      units: [
        {
          assetId: 'asset.file',
          target: targetPath('project', ['asset.txt']),
          path: '/project/asset.txt',
          unit: { kind: 'file' },
          desired: { exists: true, encoding: 'utf8', content, checksum: checksumText(content) },
          current: {
            exists: true,
            encoding: 'base64',
            content: Buffer.from(content).toString('base64'),
            checksum: checksumText(content),
          },
          container: {
            path: '/project/asset.txt',
            exists: true,
            content: Buffer.from(content).toString('base64'),
            checksum: checksumText(content),
          },
          source,
        },
      ],
      pendingTransaction: false,
    };
    const plan = createInstallationPlan(snapshot, 'install');
    expect(plan.conflicts).toHaveLength(1);
    expect(() => assertPlanAuthorized(plan)).toThrow(/unapproved/u);
    const authorized = authorizePlan(plan, [plan.conflicts[0]!.id]);
    expect(() => assertPlanAuthorized(authorized)).not.toThrow();
  });

  it('rejects host configuration plans for the wrong manifest host', () => {
    const plan: HostConfigPlan = {
      hostId: 'other',
      scope: 'project',
      target: { candidates: [targetPath('project', ['host.json'])], createAt: targetPath('project', ['host.json']) },
      operations: [],
    };
    expect(() =>
      createAssetManifest({
        installationId: 'default',
        producer: { name: '@neottia/test', version: '1.0.0' },
        harnessId: 'test',
        scope: 'project',
        configChecksum: checksumText('{}\n'),
        templates: [],
        prerequisites: [],
        assets: [{ kind: 'host-config', id: 'host.config', plan, source }],
      }),
    ).toThrow(/does not match/u);
  });
});
