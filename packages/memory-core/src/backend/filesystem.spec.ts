import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMemoryConfig } from '../config.js';
import type { MemoryRecord } from '../schemas.js';
import { FilesystemBackend, type MemoryRecordInput } from './filesystem.js';

const tempDirs: string[] = [];
const NOW = (): Date => new Date('2025-01-01T00:00:00.000Z');

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('repository-backed filesystem publication', () => {
  it('publishes canonical YAML only through the repository transaction layer', async () => {
    const { backend } = fixture();
    const record = makeRecord(backend, 'default publication');

    await backend.applyBatch([{ path: backend.recordPath(record), bytes: backend.encode(record), exclusive: true }]);

    expect((await backend.loadState()).records).toEqual([record]);
  });

  it('uses the strict ULID range for canonical paths', async () => {
    const { backend } = fixture();
    const boundary = { ...makeRecord(backend, 'ULID boundary'), id: '7ZZZZZZZZZZZZZZZZZZZZZZZZZ' };
    await backend.applyBatch([{ path: `facts/${boundary.id}.yaml`, bytes: backend.encode(boundary), exclusive: true }]);
    const overflow = { ...boundary, id: '80000000000000000000000000' };

    await expect(
      backend.applyBatch([{ path: `facts/${overflow.id}.yaml`, bytes: backend.encode(overflow), exclusive: true }]),
    ).rejects.toThrow(/Invalid memory filename/u);
    expect((await backend.loadState()).records).toEqual([boundary]);
  });

  it('rejects canonical files replaced with symbolic links', async () => {
    const { backend, cwd } = fixture();
    const record = makeRecord(backend, 'canonical');
    await backend.applyBatch([{ path: backend.recordPath(record), bytes: backend.encode(record), exclusive: true }]);
    const path = join(backend.memoryRoot, backend.recordPath(record));
    const outside = join(cwd, 'outside.yaml');
    writeFileSync(outside, backend.encode(record));
    rmSync(path);
    symlinkSync(outside, path);

    await expect(backend.loadState()).rejects.toThrow(/Unsafe memory file|safely read managed memory path/u);
  });
});

function fixture(): {
  backend: FilesystemBackend;
  config: ReturnType<typeof loadMemoryConfig>;
  cwd: string;
} {
  const cwd = mkdtempSync(join(tmpdir(), 'neottia-filesystem-'));
  tempDirs.push(cwd);
  const config = loadMemoryConfig(cwd, { env: { NEOTTIA_MEMORY_ENABLED: 'true' } });
  return { backend: new FilesystemBackend({ config, cwd }), config, cwd };
}

function makeRecord(backend: FilesystemBackend, summary: string): MemoryRecord {
  const input: MemoryRecordInput = {
    memory_type: 'semantic',
    record_type: 'fact',
    summary,
    source: { kind: 'artifact', ref: null, revision: null },
    created_by: 'test',
    confidence: 'verified',
  };
  return backend.makeRecord(input, [], NOW);
}
