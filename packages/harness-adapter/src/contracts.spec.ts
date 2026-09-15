import { describe, expect, it } from 'vitest';
import {
  HOST_FEATURES,
  PACKAGE_VERSION_PATTERN,
  createHarnessAdapterRegistry,
  defineHarnessAdapter,
  defineHarnessDeclaration,
  projectionFailure,
  projectionSuccess,
  supportedFeature,
  targetPath,
  type FeatureSupport,
  type HarnessAdapter,
  type HarnessDeclaration,
  type HostFeature,
} from './index.js';

/** Builds one complete test declaration without relying on a host adapter. */
function declaration(id = 'test'): HarnessDeclaration {
  const features = Object.fromEntries(
    HOST_FEATURES.map((feature) => [
      feature,
      {
        status: 'supported',
        scopes: ['project'],
        projection: feature.startsWith('asset.') ? 'file' : feature.startsWith('config.') ? 'host-config' : 'metadata',
      },
    ]),
  ) as Record<HostFeature, FeatureSupport>;
  return defineHarnessDeclaration({
    contractVersion: 1,
    id,
    displayName: 'Test host',
    testedHostVersions: ['1.0.0'],
    features,
  });
}

/** Creates the smallest complete adapter used to test registry mechanics. */
function adapter(id = 'test'): HarnessAdapter {
  const unsupported = () =>
    projectionFailure([
      {
        code: 'UNSUPPORTED_HOST_FEATURE' as const,
        hostId: id,
        feature: 'asset.prompt' as const,
        message: 'unsupported',
      },
    ]);
  return Object.freeze({
    declaration: declaration(id),
    target: unsupported,
    projectPrompt: unsupported,
    projectSkill: unsupported,
    projectExtension: unsupported,
    projectAgent: unsupported,
    declarePackage: unsupported,
    planHostConfiguration: unsupported,
    reloadNotice: unsupported,
  });
}

describe('harness adapter contracts', () => {
  it('requires an exact complete feature record', () => {
    const complete = declaration();
    expect(Object.keys(complete.features)).toEqual(HOST_FEATURES);
    expect(Object.isFrozen(complete.features)).toBe(true);
    expect(() =>
      defineHarnessDeclaration({
        ...complete,
        features: { ...complete.features, extra: complete.features['asset.prompt'] } as Record<
          HostFeature,
          FeatureSupport
        >,
      }),
    ).toThrow('every known feature');
    const missing = { ...complete.features } as Partial<Record<HostFeature, FeatureSupport>>;
    Reflect.deleteProperty(missing, 'asset.agent');
    expect(() =>
      defineHarnessDeclaration({ ...complete, features: missing as Record<HostFeature, FeatureSupport> }),
    ).toThrow('every known feature');
  });

  it('rejects declaration primitives and every unknown support enum', () => {
    const complete = declaration();
    for (const input of [null, 123]) {
      expect(() => defineHarnessDeclaration(input as never)).toThrow('must be an object');
    }
    for (const id of [123, null]) {
      expect(() => defineHarnessDeclaration({ ...complete, id } as never)).toThrow('id is invalid');
    }
    expect(() => supportedFeature('unknown' as never)).toThrow('valid projection');
    for (const support of [
      { status: 'unknown', scopes: ['project'], projection: 'file' },
      { status: 'supported', scopes: ['workspace'], projection: 'file' },
      { status: 'supported', scopes: ['project'], projection: 'unknown' },
      { status: 'supported', scopes: ['project'], projection: 'metadata' },
      { status: 'supported', scopes: ['project'], projection: 'file', reason: 42 },
    ]) {
      expect(() =>
        defineHarnessDeclaration({
          ...complete,
          features: { ...complete.features, 'asset.prompt': support as never },
        }),
      ).toThrow();
    }
  });

  it('rejects inconsistent unsupported declarations', () => {
    const complete = declaration();
    expect(() =>
      defineHarnessDeclaration({
        ...complete,
        features: {
          ...complete.features,
          'asset.agent': { status: 'unsupported', scopes: ['project'], projection: 'none', reason: 'Absent.' },
        },
      }),
    ).toThrow('must declare no projection');
  });

  it('registers injected adapters and rejects duplicate ids', () => {
    const value = adapter();
    const registry = createHarnessAdapterRegistry([value]);
    expect(registry.get('test')).not.toBe(value);
    expect(registry.get('test')?.declaration).toEqual(value.declaration);
    expect(registry.get('missing')).toBeUndefined();
    expect(Object.isFrozen(registry.adapters)).toBe(true);
    expect(() => createHarnessAdapterRegistry([value, adapter()])).toThrow('unique');
  });

  it('snapshots mutable third-party declarations and methods', () => {
    const sourceDeclaration = structuredClone(declaration());
    const sourceVersions = sourceDeclaration.testedHostVersions as string[];
    const sourceFeatures = sourceDeclaration.features as Record<HostFeature, FeatureSupport>;
    const source = { ...adapter(), declaration: sourceDeclaration };
    const registry = createHarnessAdapterRegistry([source]);
    sourceVersions.push('2.0.0');
    sourceDeclaration.id = 'changed';
    sourceFeatures['asset.prompt'] = { status: 'unsupported', scopes: [], projection: 'none', reason: 'Changed.' };
    source.target = () => projectionSuccess(targetPath('project', ['changed']));

    const registered = registry.get('test')!;
    expect(registered.declaration.id).toBe('test');
    expect(registered.declaration.testedHostVersions).toEqual(['1.0.0']);
    expect(registered.declaration.features['asset.prompt'].status).toBe('supported');
    expect(registered.target({ feature: 'asset.prompt', scope: 'project', assetId: 'test' }).diagnostics[0]?.code).toBe(
      'UNSUPPORTED_HOST_FEATURE',
    );
  });

  it('preserves method receivers and rejects invalid third-party results', () => {
    const receiverAware = defineHarnessAdapter({
      ...adapter(),
      target() {
        return projectionSuccess(targetPath('project', [this.declaration.id]));
      },
    });
    expect(receiverAware.target({ feature: 'asset.prompt', scope: 'project', assetId: 'test' }).value).toEqual({
      anchor: 'project',
      segments: ['test'],
    });

    const diagnostic = {
      code: 'INVALID_CONTENT' as const,
      hostId: 'test',
      feature: 'asset.prompt' as const,
      message: 'invalid',
    };
    const throwingResult = Object.defineProperty({ diagnostics: [] }, 'value', {
      enumerable: true,
      get() {
        throw new TypeError('malformed result');
      },
    });
    for (const invalidResult of [
      { value: targetPath('project', ['test']), diagnostics: [diagnostic] },
      { diagnostics: [] },
      throwingResult,
    ]) {
      const invalid = defineHarnessAdapter({
        ...adapter(),
        target: () => invalidResult as never,
      });
      const result = invalid.target({ feature: 'asset.prompt', scope: 'project', assetId: 'test' });
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toMatchObject([{ code: 'INVALID_ADAPTER_RESULT' }]);
    }
  });

  it('rejects unsafe targets, locators, and malformed projected files', () => {
    const targetRequest = { feature: 'asset.prompt' as const, scope: 'project' as const, assetId: 'plan' };
    const unsafeTarget = defineHarnessAdapter({
      ...adapter(),
      target: () => projectionSuccess({ anchor: 'project', segments: ['..'] } as never),
    });
    expect(unsafeTarget.target(targetRequest).diagnostics).toMatchObject([{ code: 'INVALID_ADAPTER_RESULT' }]);

    const badLocator = defineHarnessAdapter({
      ...adapter(),
      target: () =>
        projectionSuccess({
          candidates: [{ anchor: 'project', segments: ['settings.json'] }],
          createAt: { anchor: 'home', segments: ['settings.json'] },
        } as never),
    });
    expect(badLocator.target({ feature: 'config.package', scope: 'project' }).diagnostics).toMatchObject([
      { code: 'INVALID_ADAPTER_RESULT' },
    ]);

    const requests = {
      projectPrompt: { id: 'plan', scope: 'project', body: 'Plan.\n' },
      projectSkill: { id: 'review', scope: 'project', description: 'Review.', body: 'Review.\n' },
      projectExtension: { id: 'plugin', scope: 'project', source: 'export {}' },
      projectAgent: {
        id: 'reviewer',
        scope: 'project',
        body: 'Review.\n',
        description: 'Review.',
        mode: 'primary',
      },
    } as const;
    const invalidFiles = [
      defineHarnessAdapter({
        ...adapter(),
        projectPrompt: () =>
          projectionSuccess({
            assetId: 'plan',
            feature: 'asset.prompt',
            target: { anchor: 'invalid', segments: ['plan.md'] },
            mediaType: 'text/markdown',
            content: 'Plan.\n',
          } as never),
      }).projectPrompt(requests.projectPrompt),
      defineHarnessAdapter({
        ...adapter(),
        projectSkill: () =>
          projectionSuccess({
            assetId: 'other',
            feature: 'asset.skill',
            target: { anchor: 'project', segments: ['SKILL.md'] },
            mediaType: 'text/markdown',
            content: 'Review.\n',
          } as never),
      }).projectSkill(requests.projectSkill),
      defineHarnessAdapter({
        ...adapter(),
        projectExtension: () =>
          projectionSuccess({
            assetId: 'plugin',
            feature: 'asset.extension',
            target: { anchor: 'project', segments: ['plugin.ts'] },
            mediaType: 'text/markdown',
            content: 'export {}',
          } as never),
      }).projectExtension(requests.projectExtension),
      defineHarnessAdapter({
        ...adapter(),
        projectAgent: () =>
          projectionSuccess({
            assetId: 'reviewer',
            feature: 'asset.agent',
            target: { anchor: 'project', segments: ['reviewer.md'] },
            mediaType: 'text/markdown',
          } as never),
      }).projectAgent(requests.projectAgent),
    ];
    for (const result of invalidFiles) {
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toMatchObject([{ code: 'INVALID_ADAPTER_RESULT' }]);
    }
  });

  it('rejects malformed package, config plan, operation, and reload results', () => {
    const packageRequest = { logicalId: 'memory' as const, scope: 'project' as const, version: '1.2.3' };
    const badPackage = defineHarnessAdapter({
      ...adapter(),
      declarePackage: () =>
        projectionSuccess({
          logicalId: 'memory',
          scope: 'project',
          source: { ecosystem: 'npm', name: '@neottia/test', version: '01.2.3' },
          activation: 'opencode-plugin',
          provides: ['extension'],
        } as never),
    });
    expect(badPackage.declarePackage(packageRequest).diagnostics).toMatchObject([{ code: 'INVALID_ADAPTER_RESULT' }]);

    const configRequest = {
      kind: 'package' as const,
      package: {
        logicalId: 'memory' as const,
        scope: 'project' as const,
        source: { ecosystem: 'npm' as const, name: '@neottia/test', version: '1.2.3' },
        activation: 'opencode-plugin' as const,
        provides: ['extension'] as const,
      },
    };
    const planBase = {
      hostId: 'test',
      scope: 'project',
      target: {
        candidates: [{ anchor: 'project', segments: ['config.json'] }],
        createAt: { anchor: 'project', segments: ['config.json'] },
      },
    };
    const invalidPlans = [
      { ...planBase, hostId: 'other', operations: [] },
      {
        ...planBase,
        operations: [
          {
            id: 'package:memory',
            kind: 'ensure-array-entry',
            pointer: '/plugin',
            identity: 'npm:@neottia/test',
            owner: 'neottia',
          },
        ],
      },
      {
        ...planBase,
        operations: [
          {
            id: 'package:memory',
            kind: 'unknown',
            pointer: '/plugin',
            identity: 'npm:@neottia/test',
            value: '@neottia/test@1.2.3',
            owner: 'neottia',
          },
        ],
      },
    ];
    for (const plan of invalidPlans) {
      const invalid = defineHarnessAdapter({
        ...adapter(),
        planHostConfiguration: () => projectionSuccess(plan as never),
      });
      const result = invalid.planHostConfiguration(configRequest);
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toMatchObject([{ code: 'INVALID_ADAPTER_RESULT' }]);
    }

    const opaqueValue = { custom: [null, { enabled: true }] };
    const opaquePlan = defineHarnessAdapter({
      ...adapter(),
      planHostConfiguration: () =>
        projectionSuccess({
          ...planBase,
          operations: [
            {
              id: 'custom:memory',
              kind: 'ensure-object-entry',
              pointer: '/custom',
              key: 'memory',
              value: opaqueValue,
              owner: 'neottia',
            },
          ],
        } as never),
    }).planHostConfiguration(configRequest);
    expect(opaquePlan.value?.operations[0]?.value).toEqual(opaqueValue);

    for (const notice of [
      { hostId: 'other', action: 'restart', message: 'Restart.', affectedFeatures: ['asset.prompt'] },
      { hostId: 'test', action: 'unknown', message: 'Restart.', affectedFeatures: ['asset.prompt'] },
      { hostId: 'test', action: 'command', message: 'Reload.', affectedFeatures: ['asset.prompt'] },
      { hostId: 'test', action: 'restart', message: 'Restart.', affectedFeatures: [] },
    ]) {
      const invalidReload = defineHarnessAdapter({
        ...adapter(),
        reloadNotice: () => projectionSuccess(notice as never),
      });
      expect(invalidReload.reloadNotice({ changedFeatures: ['asset.prompt'] }).diagnostics).toMatchObject([
        { code: 'INVALID_ADAPTER_RESULT', hostId: 'test' },
      ]);
    }
  });

  it('rejects diagnostics that claim a different host', () => {
    const invalid = defineHarnessAdapter({
      ...adapter(),
      target: () =>
        projectionFailure([
          {
            code: 'INVALID_CONTENT',
            hostId: 'other',
            feature: 'asset.prompt',
            message: 'Wrong host.',
          },
        ]),
    });
    const result = invalid.target({ feature: 'asset.prompt', scope: 'project', assetId: 'plan' });
    expect(result.value).toBeUndefined();
    expect(result.diagnostics).toEqual([
      {
        code: 'INVALID_ADAPTER_RESULT',
        hostId: 'test',
        feature: 'asset.prompt',
        message: 'The adapter returned a result that does not satisfy the runtime contract.',
      },
    ]);
  });

  it('accepts only exact SemVer 2 package versions', () => {
    for (const valid of ['0.0.0', '1.2.3', '1.2.3-alpha.1', '1.2.3+build.1', '1.2.3-rc.1+build.5']) {
      expect(PACKAGE_VERSION_PATTERN.test(valid)).toBe(true);
    }
    for (const invalid of ['01.2.3', '1.02.3', '1.2.03', '1.2.3-01', '1.2', 'v1.2.3', '1.2.3+']) {
      expect(PACKAGE_VERSION_PATTERN.test(invalid)).toBe(false);
    }
  });

  it('detaches and freezes all result data', () => {
    const source = { nested: { values: ['one'] } };
    const result = projectionSuccess(source);
    source.nested.values.push('two');
    expect(result.value).toEqual({ nested: { values: ['one'] } });
    expect(Object.isFrozen(result.value?.nested.values)).toBe(true);

    const diagnostics = [
      {
        code: 'INVALID_CONTENT' as const,
        hostId: 'test',
        feature: 'asset.prompt' as const,
        message: 'invalid',
      },
    ];
    const failure = projectionFailure(diagnostics);
    diagnostics[0]!.message = 'changed';
    expect(failure.diagnostics[0]?.message).toBe('invalid');
    expect(failure.value).toBeUndefined();
  });

  it('rejects unsafe symbolic path segments', () => {
    expect(targetPath('project', ['.pi', 'prompts', 'plan.md'])).toEqual({
      anchor: 'project',
      segments: ['.pi', 'prompts', 'plan.md'],
    });
    for (const unsafe of ['', '.', '..', 'a/b', 'a\\b', 'e\u0301']) {
      expect(() => targetPath('project', [unsafe])).toThrow('unsafe segment');
    }
  });
});
