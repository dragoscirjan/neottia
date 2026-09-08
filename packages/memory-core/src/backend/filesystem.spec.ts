import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

describe('filesystem atomic publication', () => {
  it('keeps default publication behavior when no filesystem seam is supplied', async () => {
    const { backend } = fixture();
    const record = makeRecord(backend, 'default publication');

    await backend.applyBatch([{ path: backend.recordPath(record), bytes: backend.encode(record), exclusive: true }]);

    expect((await backend.loadState()).records).toEqual([record]);
  });

  it('rolls back a single file when directory fsync fails after rename', async () => {
    const setup = fixture();
    const original = makeRecord(setup.backend, 'original');
    await setup.backend.applyBatch([
      { path: setup.backend.recordPath(original), bytes: setup.backend.encode(original), exclusive: true },
    ]);
    let syncCalls = 0;
    const backend = new FilesystemBackend({
      config: setup.config,
      cwd: setup.cwd,
      filesystemOps: {
        syncDirectory: () => {
          syncCalls += 1;
          if (syncCalls === 1) throw new Error('injected post-rename fsync failure');
        },
      },
    });
    const replacement = { ...original, summary: 'replacement' };

    await expect(
      backend.applyBatch([{ path: backend.recordPath(replacement), bytes: backend.encode(replacement) }]),
    ).rejects.toThrow('injected post-rename fsync failure');

    expect((await setup.backend.loadState()).records).toEqual([original]);
  });

  it('rolls back every published file when a later directory fsync fails', async () => {
    const setup = fixture();
    const originals = [makeRecord(setup.backend, 'first original'), makeRecord(setup.backend, 'second original')];
    await setup.backend.applyBatch(
      originals.map((record) => ({
        path: setup.backend.recordPath(record),
        bytes: setup.backend.encode(record),
        exclusive: true,
      })),
    );
    let syncCalls = 0;
    const backend = new FilesystemBackend({
      config: setup.config,
      cwd: setup.cwd,
      filesystemOps: {
        syncDirectory: () => {
          syncCalls += 1;
          if (syncCalls === 2) throw new Error('injected second post-rename fsync failure');
        },
      },
    });
    const replacements = originals.map((record) => ({ ...record, summary: `${record.summary} replaced` }));

    await expect(
      backend.applyBatch(
        replacements.map((record) => ({ path: backend.recordPath(record), bytes: backend.encode(record) })),
      ),
    ).rejects.toThrow('injected second post-rename fsync failure');

    expect(new Map((await setup.backend.loadState()).records.map((record) => [record.id, record]))).toEqual(
      new Map(originals.map((record) => [record.id, record])),
    );
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

  it('fails closed when a destination is replaced immediately after rename', async () => {
    const setup = fixture();
    const record = makeRecord(setup.backend, 'destination race');
    const outside = join(setup.cwd, 'outside.yaml');
    writeFileSync(outside, 'outside remains unchanged');
    const backend = new FilesystemBackend({
      config: setup.config,
      cwd: setup.cwd,
      filesystemOps: {
        renameSync: (source, destination) => {
          renameSync(source, destination);
          rmSync(destination);
          symlinkSync(outside, destination);
        },
      },
    });

    await expect(
      backend.applyBatch([{ path: backend.recordPath(record), bytes: backend.encode(record), exclusive: true }]),
    ).rejects.toThrow(/rollback failed|destination changed/u);
    expect(readFileSync(outside, 'utf8')).toBe('outside remains unchanged');
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
