import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  HOST_FEATURES,
  defineHarnessAdapter,
  defineHarnessDeclaration,
  projectionFailure,
  projectionSuccess,
  unsupportedFeature,
  unsupportedFeatureSupport,
  type HarnessAdapter,
  type HarnessDeclaration,
  type HarnessScope,
  type HostFeature,
  type ProjectionResult,
} from '@neottia/harness-adapter';
import { describe, expect, it } from 'vitest';
import {
  assertHarnessAdapterConformance,
  createTempHarnessEnvironment,
  materializeProjectedFile,
  resolveHarnessTarget,
} from './harness-adapter.js';

describe('temporary harness adapter environment', () => {
  it('accepts explicit unsupported prompt and skill projections', () => {
    expect(() => assertHarnessAdapterConformance(createUnsupportedAdapter())).not.toThrow();
  });

  it('resolves and materializes only below disposable roots', () => {
    const environment = createTempHarnessEnvironment();
    try {
      const target = { anchor: 'project' as const, segments: ['.pi', 'prompts', 'plan.md'] };
      const path = resolveHarnessTarget(environment, target);
      expect(dirname(path)).toContain(environment.projectRoot);
      expect(
        materializeProjectedFile(environment, {
          assetId: 'plan',
          feature: 'asset.prompt',
          target,
          mediaType: 'text/markdown',
          content: 'Plan.\n',
        }),
      ).toBe(path);
      expect(existsSync(path)).toBe(true);
    } finally {
      environment.cleanup();
    }
    expect(existsSync(environment.root)).toBe(false);
  });
});

/** Creates a valid adapter that explicitly supports no host features. */
function createUnsupportedAdapter(): HarnessAdapter {
  const features = Object.fromEntries(
    HOST_FEATURES.map((feature) => [feature, unsupportedFeatureSupport('Unavailable in this test host.')]),
  ) as HarnessDeclaration['features'];
  const declaration = defineHarnessDeclaration({
    contractVersion: 1,
    id: 'unsupported-test',
    displayName: 'Unsupported test host',
    testedHostVersions: [],
    features,
  });
  return defineHarnessAdapter({
    declaration,
    target(request) {
      return unsupportedProjection(request.feature, request.scope);
    },
    projectPrompt(request) {
      return unsupportedProjection('asset.prompt', request.scope);
    },
    projectSkill(request) {
      return unsupportedProjection('asset.skill', request.scope);
    },
    projectExtension(request) {
      return unsupportedProjection('asset.extension', request.scope);
    },
    projectAgent(request) {
      return unsupportedProjection('asset.agent', request.scope);
    },
    declarePackage(request) {
      return unsupportedProjection('config.package', request.scope);
    },
    planHostConfiguration(request) {
      const feature = request.kind === 'package' ? 'config.package' : request.kind;
      const scope = request.kind === 'package' ? request.package.scope : request.scope;
      return unsupportedProjection(feature, scope);
    },
    reloadNotice(request) {
      return projectionSuccess({
        hostId: declaration.id,
        action: 'none',
        message: 'No reload is available.',
        affectedFeatures: request.changedFeatures,
      });
    },
  });
}

/** Returns a typed unsupported result for the synthetic conformance adapter. */
function unsupportedProjection(feature: HostFeature, scope: HarnessScope): ProjectionResult<never> {
  return projectionFailure([unsupportedFeature('unsupported-test', feature, scope)]);
}
