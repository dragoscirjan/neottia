import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMemoryConfig } from './config.js';
import { createSecretScanner } from './security.js';
import { MemoryStore } from './store.js';

const tempDirs: string[] = [];
const OPENAI_SK = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
const OPENAI_PROJECT_SK = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890';

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('secret scanning', () => {
  it.each([
    '-----BEGIN PRIVATE KEY-----',
    'AKIA1234567890ABCDEF',
    'ghp_abcdefghijklmnopqrstuvwxyz',
    'sk-live-abcdefghijklmnop',
    'password=hunter2',
    OPENAI_SK,
    OPENAI_PROJECT_SK,
  ])('preserves built-in detection for %s', (secret) => {
    const scan = createSecretScanner({ customPatterns: [], entropyHeuristic: false });
    expect(() => scan(secret)).toThrow(/Suspected secret/u);
  });

  it('rejects OpenAI keys from store and import without mutating canonical files when entropy is disabled', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'neottia-security-'));
    tempDirs.push(cwd);
    const config = loadMemoryConfig(cwd, {
      env: {
        NEOTTIA_MEMORY_ENABLED: 'true',
        NEOTTIA_MEMORY_SECURITY_ENTROPY_HEURISTIC: 'false',
      },
    });
    const store = MemoryStore.fromConfig(config, cwd, { now: () => new Date('2025-01-01T00:00:00.000Z') });

    await expect(
      store.store({
        memory_type: 'semantic',
        record_type: 'fact',
        summary: `Leaked account key ${OPENAI_SK}`,
        source: { kind: 'user-confirmed', ref: null, revision: null },
        created_by: 'test',
        confidence: 'confirmed',
      }),
    ).rejects.toThrow(/Suspected secret/u);
    expect(canonicalFiles(join(cwd, config.root))).toEqual([]);

    const imported = {
      schema_version: 1,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      memory_type: 'semantic',
      record_type: 'fact',
      organization_id: 'local',
      project_id: 'project',
      topic: 'general',
      summary: `Leaked project key ${OPENAI_PROJECT_SK}`,
      details: null,
      source: { kind: 'artifact', ref: null, revision: null },
      created_at: '2025-01-01T00:00:00.000Z',
      created_by: 'test',
      confidence: 'verified',
      status: 'active',
      supersedes: [],
      tags: [],
    };
    await expect(store.import(`${JSON.stringify(imported)}\n`)).rejects.toThrow(/Suspected secret/u);
    expect(canonicalFiles(join(cwd, config.root))).toEqual([]);
    await store.close();
  });
});

function canonicalFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => entry.name)
    .sort();
}
