import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRelativePath } from '@neottia/repository-store';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ISSUE_ENV_BINDINGS, issueConfigSchema, loadIssueConfig } from './config.js';

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
      expect(() => loadIssueConfig(fixture('version: 1\n'), { root })).toThrow(/non-reserved/u);
  });

  it('keeps runtime, generated-schema, and backend root constraints aligned', () => {
    const generated = z.toJSONSchema(issueConfigSchema) as { properties: { root: { pattern: string } } };
    const published = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8')) as unknown;
    expect(published).toEqual(generated);
    const pattern = new RegExp(generated.properties.root.pattern, 'u');
    const valid = [
      '.neottia/issues',
      'issues',
      'nested/issues',
      '.neottia/cache-x',
      '.neottia/repository-store-backup',
    ];
    const invalid = [
      '.neottia',
      '.neottia/cache',
      '.neottia/cache/issues',
      '.neottia/repository-store',
      '.neottia/repository-store/issues',
      '.neottia/CACHE/issues',
      '.NEOTTIA/RePoSiToRy-StOrE',
      'issues.',
      'nested/issues.',
      '.',
      '..',
      '../outside',
      '/absolute',
      'a\\b',
    ];
    for (const root of valid) {
      expect(issueConfigSchema.safeParse({ root }).success).toBe(true);
      expect(pattern.test(root)).toBe(true);
      expect(validateRelativePath(root)).toBe(root);
    }
    for (const root of invalid) {
      expect(issueConfigSchema.safeParse({ root }).success).toBe(false);
      expect(pattern.test(root)).toBe(false);
    }
    for (const root of ['issues.', 'nested/issues.']) expect(() => validateRelativePath(root)).toThrow();
  });

  it('publishes a binding for every configurable environment leaf', () => {
    expect(new Set(ISSUE_ENV_BINDINGS.map(([path]) => path)).size).toBe(ISSUE_ENV_BINDINGS.length);
    expect(ISSUE_ENV_BINDINGS.every(([, name]) => name.startsWith('NEOTTIA_ISSUES_'))).toBe(true);
  });
});
