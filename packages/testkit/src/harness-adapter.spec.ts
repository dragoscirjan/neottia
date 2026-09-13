import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempHarnessEnvironment, materializeProjectedFile, resolveHarnessTarget } from './harness-adapter.js';

describe('temporary harness adapter environment', () => {
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
