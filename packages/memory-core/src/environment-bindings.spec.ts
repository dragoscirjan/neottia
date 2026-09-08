import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMemoryConfig } from './config.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('documented environment bindings', () => {
  it('does not infer pseudo environment names for secret patterns or security limits', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'neottia-env-bindings-'));
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.neottia'));
    writeFileSync(
      join(cwd, '.neottia', 'config.yml'),
      `version: 1
skills:
  memory:
    security:
      secret_patterns:
        - from-file
      limits:
        max_file_bytes: 2048
        max_files: 12
        max_total_bytes: 4096
`,
    );

    const config = loadMemoryConfig(cwd, {
      env: {
        NEOTTIA_MEMORY_SECURITY_SECRET_PATTERNS: '["from-environment"]',
        NEOTTIA_MEMORY_SECURITY_LIMITS_MAX_FILE_BYTES: '9999',
        NEOTTIA_MEMORY_SECURITY_LIMITS_MAX_FILES: '9999',
        NEOTTIA_MEMORY_SECURITY_LIMITS_MAX_TOTAL_BYTES: '9999',
      },
    });

    expect(config.security.secret_patterns).toEqual(['from-file']);
    expect(config.security.limits).toEqual({ max_file_bytes: 2048, max_files: 12, max_total_bytes: 4096 });
  });
});
