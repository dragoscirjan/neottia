import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_STORE_LIMITS,
  LeaseContentionError,
  PathSafetyError,
  StaleRevisionError,
  applyCanonicalBatch,
  computeByteRevision,
  readManagedFile,
  resolveManagedPath,
  resolveManagedRoot,
  withRepositoryLease,
} from './index.js';
import {
  LEASE_FAULT_EVENTS,
  TRANSACTION_FAULT_EVENTS,
  type LeaseFaultEvent,
  type TransactionFaultEvent,
} from './internal/fault-injection.js';
import { getRootState } from './internal/model.js';
import {
  createTransactionDirectory,
  manifestDigest,
  transactionRoot,
  writeDurableFile,
} from './transaction/journal.js';
import type { JournalManifest } from './transaction/types.js';

const tempDirectories: string[] = [];
const CRASH_CASES = [
  ['prepare-directory-created', 1, false],
  ['before-image-written', 1, false],
  ['before-image-written', 2, false],
  ['staged-artifact-written', 1, false],
  ['staged-artifact-written', 2, false],
  ['manifest-written', 1, false],
  ['prepare-directory-synced', 1, false],
  ['active-state-renamed', 1, false],
  ['active-state-synced', 1, false],
  ['canonical-path-published', 1, false],
  ['canonical-path-published', 2, false],
  ['committed-state-renamed', 1, true],
  ['committed-state-synced', 1, true],
  ['cleanup-state-renamed', 1, true],
  ['cleanup-state-synced', 1, true],
  ['cleanup-artifact-removed', 1, true],
  ['cleanup-artifact-removed', 2, true],
  ['cleanup-artifact-removed', 3, true],
  ['cleanup-artifact-removed', 4, true],
  ['cleanup-manifest-removed', 1, true],
  ['cleanup-directory-removed', 1, true],
  ['cleanup-root-synced', 1, true],
] as const satisfies readonly (readonly [TransactionFaultEvent, number, boolean])[];

afterEach(() => {
  while (tempDirectories.length > 0) rmSync(tempDirectories.pop() as string, { recursive: true, force: true });
});

describe('repository canonical store', () => {
  it('keeps authority-bearing state private and rejects forged handles', async () => {
    const root = await fixture();
    const path = resolveManagedPath(root, 'records/private.txt');
    expect(Object.getOwnPropertySymbols(root)).toEqual([]);
    expect(Object.getOwnPropertySymbols(path)).toEqual([]);
    await expect(
      withRepositoryLease(root, async (lease) => {
        expect(Object.getOwnPropertySymbols(lease)).toEqual([]);
        await readManagedFile(root, lease, { relativePath: path.relativePath } as typeof path);
      }),
    ).rejects.toMatchObject({ code: 'PATH_INVALID' });
  });

  it('applies exact write, replacement, move, and removal operations', async () => {
    const root = await fixture();
    const first = resolveManagedPath(root, 'records/first.txt');
    const moved = resolveManagedPath(root, 'archive/first.txt');
    await withRepositoryLease(root, async (lease) => {
      await applyCanonicalBatch(root, lease, [{ kind: 'write', path: first, bytes: bytes('one'), expected: 'absent' }]);
      const revision = (await readManagedFile(root, lease, first)).revision;
      await applyCanonicalBatch(root, lease, [{ kind: 'write', path: first, bytes: bytes('two'), expected: revision }]);
      const replaced = (await readManagedFile(root, lease, first)).revision;
      await applyCanonicalBatch(root, lease, [
        {
          kind: 'move',
          from: first,
          to: moved,
          expectedSource: replaced,
          expectedDestination: 'absent',
        },
      ]);
      const movedRevision = (await readManagedFile(root, lease, moved)).revision;
      await applyCanonicalBatch(root, lease, [{ kind: 'remove', path: moved, expected: movedRevision }]);
    });
    expect(() => readFileSync(join(root.managedRoot, 'archive/first.txt'))).toThrow();
  });

  it('rejects stale revisions without changing canonical bytes', async () => {
    const root = await fixture();
    const path = resolveManagedPath(root, 'records/item.txt');
    await withRepositoryLease(root, async (lease) => {
      await applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('original'), expected: 'absent' }]);
      await expect(
        applyCanonicalBatch(root, lease, [
          { kind: 'write', path, bytes: bytes('replacement'), expected: computeByteRevision(bytes('wrong')) },
        ]),
      ).rejects.toBeInstanceOf(StaleRevisionError);
    });
    expect(readFileSync(join(root.managedRoot, 'records/item.txt'), 'utf8')).toBe('original');
  });

  it('rolls an interrupted active transaction back before the next callback', async () => {
    const root = await fixture();
    const path = resolveManagedPath(root, 'records/item.txt');
    const original = bytes('original');
    const intended = bytes('intended');
    await withRepositoryLease(root, async (lease) => {
      await applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: original, expected: 'absent' }]);
    });
    await createInterruptedTransaction(root, 'records/item.txt', original, intended);

    await withRepositoryLease(root, async (lease) => {
      expect(new TextDecoder().decode((await readManagedFile(root, lease, path)).bytes)).toBe('original');
    });
  });

  it('isolates interrupted journals and paths between managed roots sharing an authority', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-managed-roots-'));
    tempDirectories.push(authority);
    const rootA = await resolveManagedRoot({
      authorityRoot: authority,
      managedPath: 'domain-a',
      limits: DEFAULT_STORE_LIMITS,
    });
    const rootB = await resolveManagedRoot({
      authorityRoot: authority,
      managedPath: 'domain-b',
      limits: DEFAULT_STORE_LIMITS,
    });
    const pathA = resolveManagedPath(rootA, 'records/item.txt');
    const original = bytes('domain-a-original');
    const intended = bytes('domain-a-partial');
    await withRepositoryLease(rootA, async (lease) => {
      await applyCanonicalBatch(rootA, lease, [{ kind: 'write', path: pathA, bytes: original, expected: 'absent' }]);
    });
    const active = await createInterruptedTransaction(rootA, 'records/item.txt', original, intended);

    await withRepositoryLease(rootB, async (lease) => {
      await expect(readManagedFile(rootB, lease, pathA)).rejects.toMatchObject({ code: 'PATH_INVALID' });
      expect(readFileSync(join(rootA.managedRoot, 'records/item.txt'), 'utf8')).toBe('domain-a-partial');
      expect(existsSync(active)).toBe(true);
    });
    await withRepositoryLease(rootA, async (lease) => {
      expect(new TextDecoder().decode((await readManagedFile(rootA, lease, pathA)).bytes)).toBe('domain-a-original');
    });
  });

  it('recovers incomplete prepare and partially cleaned states idempotently', async () => {
    const root = await fixture();
    const identity = identityOf(root);
    const transactions = transactionRoot(root.authorityRoot, identity.managedRootId);
    const prepareToken = randomBytes(32).toString('hex');
    const prepare = join(transactions, `${prepareToken}.prepare`);
    createTransactionDirectory(prepare);
    writeDurableFile(join(prepare, `0-${prepareToken}.stage`), bytes('partial'));
    const cleanupToken = randomBytes(32).toString('hex');
    const cleanup = join(transactions, `${cleanupToken}.cleanup`);
    createTransactionDirectory(cleanup);
    writeDurableFile(join(cleanup, `0-${cleanupToken}.before`), bytes('leftover'));

    await withRepositoryLease(root, async () => undefined);
    expect(existsSync(prepare)).toBe(false);
    expect(existsSync(cleanup)).toBe(false);
    await withRepositoryLease(root, async () => undefined);
  });

  it('fails closed on malformed journals and preserves unowned near matches', async () => {
    const root = await fixture();
    const transactions = transactionRoot(root.authorityRoot, identityOf(root).managedRootId);
    const token = randomBytes(32).toString('hex');
    const active = join(transactions, `${token}.active`);
    createTransactionDirectory(active);
    writeDurableFile(join(active, 'manifest.json'), bytes('{"invalid":true}'));
    writeDurableFile(join(active, 'operator-note'), bytes('preserve'));
    const nearMatch = join(transactions, `${token}.active.operator`);
    writeFileSync(nearMatch, 'outside journal namespace');

    await expect(withRepositoryLease(root, async () => undefined)).rejects.toMatchObject({
      code: 'RECOVERY_MALFORMED',
    });
    expect(readFileSync(join(active, 'operator-note'), 'utf8')).toBe('preserve');
    expect(readFileSync(nearMatch, 'utf8')).toBe('outside journal namespace');
  });

  it('validates staged recovery bytes against maxTemporaryBytes, not the before-image bound', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-staged-limit-'));
    tempDirectories.push(authority);
    const root = await resolveManagedRoot({
      authorityRoot: authority,
      limits: { ...DEFAULT_STORE_LIMITS, maxBeforeImageBytes: 1, maxTemporaryBytes: 100 },
    });
    const intended = bytes('larger-than-before-limit');
    await createInterruptedTransaction(root, 'records/new.txt', null, intended);
    await withRepositoryLease(root, async () => undefined);
    expect(existsSync(join(root.managedRoot, 'records/new.txt'))).toBe(false);
  });

  it('snapshots caller-owned write bytes before asynchronous preflight', async () => {
    const root = await fixture();
    const path = resolveManagedPath(root, 'records/snapshot.txt');
    const payload = bytes('original');
    await withRepositoryLease(root, async (lease) => {
      const publication = applyCanonicalBatch(root, lease, [
        { kind: 'write', path, bytes: payload, expected: 'absent' },
      ]);
      payload.fill('x'.charCodeAt(0));
      await publication;
      expect(new TextDecoder().decode((await readManagedFile(root, lease, path)).bytes)).toBe('original');
    });
  });

  it('keeps every named transaction boundary in the compiled crash matrix', () => {
    expect(new Set(CRASH_CASES.map(([event]) => event))).toEqual(new Set(TRANSACTION_FAULT_EVENTS));
  });

  it.each(CRASH_CASES)(
    'recovers a compiled-package SIGKILL at %s occurrence %i',
    async (faultEvent, occurrence, committed) => {
      const authority = mkdtempSync(join(tmpdir(), 'neottia-transaction-crash-'));
      tempDirectories.push(authority);
      await runCrashWorker(authority, faultEvent, occurrence);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
      const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
      await withRepositoryLease(root, async () => undefined, { staleMs: 1 });
      expect(readFileSync(join(authority, 'records/first.txt'), 'utf8')).toBe(
        committed ? 'committed-first' : 'original-first',
      );
      expect(readFileSync(join(authority, 'records/second.txt'), 'utf8')).toBe(
        committed ? 'committed-second' : 'original-second',
      );
      const identity = identityOf(root);
      expect(readdirSync(transactionRoot(authority, identity.managedRootId))).toEqual([]);
    },
  );

  it('rejects portable path collisions before publication', async () => {
    const root = await fixture();
    await expect(
      withRepositoryLease(root, async (lease) =>
        applyCanonicalBatch(root, lease, [
          {
            kind: 'write',
            path: resolveManagedPath(root, 'records/Example.txt'),
            bytes: bytes('one'),
            expected: 'absent',
          },
          {
            kind: 'write',
            path: resolveManagedPath(root, 'records/example.txt'),
            bytes: bytes('two'),
            expected: 'absent',
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'PATH_COLLISION' });
    expect(() => readFileSync(join(root.managedRoot, 'records/Example.txt'))).toThrow();
  });

  it('fails closed for symlinks and hard links', async () => {
    const root = await fixture();
    const outside = join(tempDirectories[0] as string, 'outside.txt');
    writeFileSync(outside, 'outside');
    const linked = join(root.managedRoot, 'linked.txt');
    symlinkSync(outside, linked);
    await expect(
      withRepositoryLease(root, async (lease) => readManagedFile(root, lease, resolveManagedPath(root, 'linked.txt'))),
    ).rejects.toBeInstanceOf(PathSafetyError);
    rmSync(linked);
    linkSync(outside, linked);
    await expect(
      withRepositoryLease(root, async (lease) => readManagedFile(root, lease, resolveManagedPath(root, 'linked.txt'))),
    ).rejects.toMatchObject({ code: 'UNSAFE_HARD_LINK' });
    expect(readFileSync(outside, 'utf8')).toBe('outside');
  });
});

describe('repository authority lease', () => {
  it.each(LEASE_FAULT_EVENTS)('recovers a compiled-package lease crash at %s', async (faultEvent) => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-lease-crash-'));
    tempDirectories.push(authority);
    await runLeaseCrashWorker(authority, faultEvent);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
    await expect(withRepositoryLease(root, async () => 'recovered', { staleMs: 1 })).resolves.toBe('recovered');
    const control = join(authority, '.neottia', 'repository-store');
    expect(readdirSync(control).filter((name) => name.startsWith('authority.'))).toEqual([]);
  });

  it('serializes real worker processes under one repository authority', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-repository-workers-'));
    tempDirectories.push(authority);
    await Promise.all(['one', 'two', 'three', 'four'].map((id) => runLeaseWorker(authority, id)));
    const lines = readFileSync(join(authority, 'lease-trace.txt'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(8);
    for (let index = 0; index < lines.length; index += 2) {
      const id = lines[index]?.split(':')[0];
      expect(lines.slice(index, index + 2)).toEqual([`${id}:start`, `${id}:end`]);
    }
  });

  it('is non-reentrant and invalidates leases after callback settlement', async () => {
    const root = await fixture();
    let captured: Parameters<Parameters<typeof withRepositoryLease>[1]>[0] | undefined;
    await withRepositoryLease(root, async (lease) => {
      captured = lease;
      await expect(withRepositoryLease(root, async () => undefined)).rejects.toMatchObject({ code: 'LEASE_REENTRANT' });
    });
    await expect(
      readManagedFile(root, captured as NonNullable<typeof captured>, resolveManagedPath(root, 'x')),
    ).rejects.toBeInstanceOf(LeaseContentionError);
  });

  it.each(['directory', 'owner'] as const)('does not release a same-token %s replacement', async (replacement) => {
    const root = await fixture();
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const lock = join(control, 'authority.lease');
    await withRepositoryLease(root, async () => {
      const owner = readFileSync(join(lock, 'owner.json'));
      if (replacement === 'directory') {
        renameSync(lock, `${lock}.operator`);
        mkdirSync(lock);
      } else {
        rmSync(join(lock, 'owner.json'));
      }
      writeFileSync(join(lock, 'owner.json'), owner);
    });
    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(join(lock, 'owner.json'))).toBeTruthy();
  });

  it('reclaims only a stale, conclusively dead same-host owner', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const lock = writeTestOwner(control, 16_777_215, new Date(0));
    utimesSync(lock, new Date(0), new Date(0));

    await expect(withRepositoryLease(root, async () => 'recovered', { staleMs: 1 })).resolves.toBe('recovered');
  });

  it('reclaims a stale claim whose same-host owner is conclusively dead', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const claim = join(control, 'authority.claim');
    writeOwnerMetadata(claim, control, 16_777_215, new Date(0));
    utimesSync(claim, new Date(0), new Date(0));

    await expect(withRepositoryLease(root, async () => 'recovered', { staleMs: 1 })).resolves.toBe('recovered');
    expect(existsSync(claim)).toBe(false);
  });

  it('completes an interrupted atomic claim publication before reclaiming it', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const token = randomUUID();
    const staging = join(control, `authority.claim.prepare-${token}`);
    const claim = join(control, 'authority.claim');
    writeOwnerMetadata(staging, control, 16_777_215, new Date(0), token);
    linkSync(staging, claim);
    utimesSync(staging, new Date(0), new Date(0));
    utimesSync(claim, new Date(0), new Date(0));

    await expect(withRepositoryLease(root, async () => 'recovered', { staleMs: 1 })).resolves.toBe('recovered');
    expect(existsSync(staging)).toBe(false);
    expect(existsSync(claim)).toBe(false);
  });

  it('interrupts a contention wait promptly when its signal aborts', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    writeTestOwner(control, process.pid, new Date());
    const controller = new AbortController();
    const started = performance.now();
    setTimeout(() => controller.abort(), 20);
    await expect(
      withRepositoryLease(root, async () => undefined, { pollMs: 1_000, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(performance.now() - started).toBeLessThan(300);
  });

  it('honors an already-aborted signal without creating authority artifacts', async () => {
    const root = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(withRepositoryLease(root, async () => undefined, { signal: controller.signal })).rejects.toMatchObject(
      {
        code: 'ABORTED',
      },
    );
  });
});

async function fixture() {
  const authority = mkdtempSync(join(tmpdir(), 'neottia-repository-store-'));
  tempDirectories.push(authority);
  return resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function createInterruptedTransaction(
  root: Awaited<ReturnType<typeof fixture>>,
  relativePath: string,
  original: Uint8Array | null,
  intended: Uint8Array,
): string {
  const token = randomBytes(32).toString('hex');
  const rootIdentity = identityOf(root);
  const transactions = transactionRoot(root.authorityRoot, rootIdentity.managedRootId);
  const prepare = join(transactions, `${token}.prepare`);
  createTransactionDirectory(prepare);
  const beforeArtifact = original === null ? null : `0-${token}.before`;
  if (beforeArtifact !== null) writeDurableFile(join(prepare, beforeArtifact), original as Uint8Array);
  const stagedArtifact = `0-${token}.stage`;
  writeDurableFile(join(prepare, stagedArtifact), intended);
  const unsigned = {
    version: 1 as const,
    transactionId: token,
    authorityId: rootIdentity.authorityId,
    managedRootId: rootIdentity.managedRootId,
    entries: [
      {
        path: relativePath,
        originalRevision: original === null ? null : computeByteRevision(original),
        intendedRevision: computeByteRevision(intended),
        beforeArtifact,
        stagedArtifact,
        bytes: intended.byteLength,
      },
    ],
    createdAt: new Date().toISOString(),
  };
  const manifest: JournalManifest = { ...unsigned, digest: manifestDigest(unsigned) };
  writeDurableFile(join(prepare, 'manifest.json'), bytes(JSON.stringify(manifest)));
  const active = join(transactions, `${token}.active`);
  renameSync(prepare, active);
  const canonical = join(root.managedRoot, relativePath);
  mkdirSync(join(canonical, '..'), { recursive: true });
  writeFileSync(canonical, intended);
  return active;
}

function writeTestOwner(control: string, pid: number, acquiredAt: Date): string {
  const lock = join(control, 'authority.lease');
  mkdirSync(lock);
  writeOwnerMetadata(join(lock, 'owner.json'), control, pid, acquiredAt);
  return lock;
}

function writeOwnerMetadata(
  path: string,
  control: string,
  pid: number,
  acquiredAt: Date,
  token = randomBytes(32).toString('hex'),
): void {
  writeFileSync(
    path,
    `${JSON.stringify({
      version: 1,
      token,
      pid,
      acquiredAt: acquiredAt.toISOString(),
      hostname: hostname(),
      hostId: readFileSync(join(control, 'host-id'), 'utf8').trim(),
      runtime: 'node:test',
    })}\n`,
  );
}

function runCrashWorker(authority: string, faultEvent: string, occurrence: number): Promise<void> {
  const worker = fileURLToPath(new URL('../test/transaction-crash.mjs', import.meta.url));
  return runWorkerProcess(
    worker,
    [authority, faultEvent, String(occurrence)],
    'compiled-package crash worker',
    (code, signal) => code === null && signal === 'SIGKILL',
    false,
  );
}

function runLeaseCrashWorker(authority: string, faultEvent: LeaseFaultEvent): Promise<void> {
  const worker = fileURLToPath(new URL('../test/lease-crash.mjs', import.meta.url));
  return runWorkerProcess(
    worker,
    [authority, faultEvent],
    'compiled-package lease crash worker',
    (code, signal) => code === null && signal === 'SIGKILL',
    false,
  );
}

function runLeaseWorker(authority: string, id: string): Promise<void> {
  const worker = fileURLToPath(new URL('./lease-worker.fixture.ts', import.meta.url));
  return runWorkerProcess(worker, [authority, id], `lease worker ${id}`, (code) => code === 0);
}

async function runWorkerProcess(
  worker: string,
  arguments_: readonly string[],
  label: string,
  accepted: (code: number | null, signal: NodeJS.Signals | null) => boolean,
  typescript = true,
): Promise<void> {
  await new Promise<void>((resolveWorker, rejectWorker) => {
    const runtimeArguments = typescript ? ['--import', 'tsx', worker, ...arguments_] : [worker, ...arguments_];
    const child = spawn(process.execPath, runtimeArguments, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errorOutput = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      errorOutput += chunk;
    });
    child.once('error', rejectWorker);
    child.once('exit', (code, signal) => {
      if (accepted(code, signal)) resolveWorker();
      else rejectWorker(new Error(`${label} exited ${code}/${signal}: ${errorOutput}`));
    });
  });
}

function identityOf(root: Awaited<ReturnType<typeof fixture>>): { authorityId: string; managedRootId: string } {
  const state = getRootState(root);
  if (state === undefined) throw new Error('Test root has no internal state.');
  return state;
}
