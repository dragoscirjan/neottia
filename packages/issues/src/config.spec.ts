import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ISSUE_ENV_BINDINGS, loadIssueConfig } from './config.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture(content: string): string {
  const cwd = mkdtempSync(join(tmpdir(), 'issues-config-'));
  roots.push(cwd);
  mkdirSync(join(cwd, '.neottia'));
  writeFileSync(join(cwd, '.neottia/config.yml'), content);
  return cwd;
}

describe('skills.issues configuration', () => {
  it('applies explicit over env over file precedence', () => {
    const cwd = fixture('version: 1\nskills:\n  issues:\n    enabled: false\n    prefix: file-\n');
    const config = loadIssueConfig(cwd, {
      prefix: 'explicit-',
      env: { NEOTTIA_ISSUES_ENABLED: 'true', NEOTTIA_ISSUES_PREFIX: 'env-' },
    });
    expect(config.enabled).toBe(true);
    expect(config.prefix).toBe('explicit-');
  });

  it('rejects unknown keys and unsafe roots', () => {
    expect(() => loadIssueConfig(fixture('version: 1\nskills:\n  issues:\n    surprise: true\n'))).toThrow(
      /Unrecognized key/u,
    );
    expect(() => loadIssueConfig(fixture('version: 1\n'), { root: '../outside' })).toThrow(/project-relative/u);
    for (const root of ['.neottia', '.neottia/cache', '.neottia/cache/issues', '.neottia/repository-store'])
      expect(() => loadIssueConfig(fixture('version: 1\n'), { root })).toThrow(/must not overlap/u);
  });

  it('publishes a binding for every configurable environment leaf', () => {
    expect(new Set(ISSUE_ENV_BINDINGS.map(([path]) => path)).size).toBe(ISSUE_ENV_BINDINGS.length);
    expect(ISSUE_ENV_BINDINGS.every(([, name]) => name.startsWith('NEOTTIA_ISSUES_'))).toBe(true);
  });
});
