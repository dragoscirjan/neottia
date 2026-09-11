import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
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
  DurabilityError,
  LeaseContentionError,
  PathSafetyError,
  ResourceLimitError,
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
  setFilesystemFaultInjectorForTests,
  type LeaseFaultEvent,
  type TransactionFaultEvent,
} from './internal/fault-injection.js';
import { getRootState } from './internal/model.js';
import { setNativePublicationBackendForTests } from './internal/native-publication.js';
import { restoreQuarantinedLease } from './lease.js';
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
  setFilesystemFaultInjectorForTests(undefined);
  setNativePublicationBackendForTests(undefined);
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

  it('preserves a replacement injected in the final publication window', async () => {
    const root = await fixture();
    const path = resolveManagedPath(root, 'records/raced.txt');
    const absolute = join(root.managedRoot, path.relativePath);
    await withRepositoryLease(root, async (lease) => {
      await applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('original'), expected: 'absent' }]);
      const revision = (await readManagedFile(root, lease, path)).revision;
      setFilesystemFaultInjectorForTests((event, target) => {
        if (event !== 'before-exact-publication' || target !== absolute) return;
        rmSync(absolute);
        writeFileSync(absolute, 'operator replacement');
      });
      await expect(
        applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('intended'), expected: revision }]),
      ).rejects.toMatchObject({ code: 'RECOVERY_AMBIGUOUS' });
    });
    expect(readFileSync(absolute, 'utf8')).toBe('operator replacement');
  });

  it('does not overwrite a raced exact evacuation destination', async () => {
    const root = await fixture();
    const path = resolveManagedPath(root, 'records/evacuation.txt');
    await withRepositoryLease(root, async (lease) => {
      await applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('canonical'), expected: 'absent' }]);
      const expected = (await readManagedFile(root, lease, path)).revision;
      let evacuation = '';
      setFilesystemFaultInjectorForTests((event, target) => {
        if (event === 'before-exact-evacuation') {
          evacuation = target;
          writeFileSync(target, 'operator evidence');
        }
      });
      await expect(
        applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('next'), expected }]),
      ).rejects.toMatchObject({ code: 'RECOVERY_AMBIGUOUS' });
      expect(readFileSync(join(root.managedRoot, path.relativePath), 'utf8')).toBe('canonical');
      expect(readFileSync(evacuation, 'utf8')).toBe('operator evidence');
    });
  });

  it('rejects an unavailable native backend before destructive mutation', async () => {
    const root = await fixture();
    const path = resolveManagedPath(root, 'records/native-required.txt');
    await withRepositoryLease(root, async (lease) => {
      await applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('original'), expected: 'absent' }]);
      const expected = (await readManagedFile(root, lease, path)).revision;
      setNativePublicationBackendForTests(null);
      await expect(
        applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('changed'), expected }]),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_RUNTIME' });
      expect(readFileSync(join(root.managedRoot, path.relativePath), 'utf8')).toBe('original');
    });
  });

  it('classifies native EINVAL without destructively evacuating canonical bytes', async () => {
    const root = await fixture();
    const path = resolveManagedPath(root, 'records/native-einval.txt');
    await withRepositoryLease(root, async (lease) => {
      await applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('original'), expected: 'absent' }]);
      const expected = (await readManagedFile(root, lease, path)).revision;
      setNativePublicationBackendForTests({
        supportsLocalPath: () => true,
        renameNoReplace() {
          throw Object.assign(new Error('unsupported rename flags'), { code: 'EINVAL' });
        },
      });
      await expect(
        applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('changed'), expected }]),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_RUNTIME' });
      expect(readFileSync(join(root.managedRoot, path.relativePath), 'utf8')).toBe('original');
    });
  });

  it('preserves a replacement injected in the final removal window', async () => {
    const root = await fixture();
    const path = resolveManagedPath(root, 'records/remove-race.txt');
    const absolute = join(root.managedRoot, path.relativePath);
    await withRepositoryLease(root, async (lease) => {
      await applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('original'), expected: 'absent' }]);
      const revision = (await readManagedFile(root, lease, path)).revision;
      setFilesystemFaultInjectorForTests((event, target) => {
        if (event !== 'before-exact-removal' || target !== absolute) return;
        rmSync(absolute);
        writeFileSync(absolute, 'operator replacement');
      });
      await expect(
        applyCanonicalBatch(root, lease, [{ kind: 'remove', path, expected: revision }]),
      ).rejects.toMatchObject({ code: 'RECOVERY_AMBIGUOUS' });
    });
    expect(readFileSync(absolute, 'utf8')).toBe('operator replacement');
  });

  it('counts both move paths against maxBatchPaths before mutation', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-normalized-bound-'));
    tempDirectories.push(authority);
    const seeded = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
    const source = resolveManagedPath(seeded, 'source.txt');
    await withRepositoryLease(seeded, async (lease) => {
      await applyCanonicalBatch(seeded, lease, [
        { kind: 'write', path: source, bytes: bytes('source'), expected: 'absent' },
      ]);
    });
    const root = await resolveManagedRoot({
      authorityRoot: authority,
      limits: { ...DEFAULT_STORE_LIMITS, maxBatchPaths: 1 },
    });
    await withRepositoryLease(root, async (lease) => {
      const revision = (await readManagedFile(root, lease, resolveManagedPath(root, 'source.txt'))).revision;
      await expect(
        applyCanonicalBatch(root, lease, [
          {
            kind: 'move',
            from: resolveManagedPath(root, 'source.txt'),
            to: resolveManagedPath(root, 'destination.txt'),
            expectedSource: revision,
            expectedDestination: 'absent',
          },
        ]),
      ).rejects.toBeInstanceOf(ResourceLimitError);
    });
    expect(readFileSync(join(authority, 'source.txt'), 'utf8')).toBe('source');
    expect(existsSync(join(authority, 'destination.txt'))).toBe(false);
  });

  it.each(['destination-evacuated', 'exclusive-destination-published'] as const)(
    'recovers an interrupted exact publication at %s',
    async (event) => {
      const root = await fixture();
      const path = resolveManagedPath(root, 'records/publication-crash.txt');
      await withRepositoryLease(root, async (lease) => {
        await applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('original'), expected: 'absent' }]);
        const revision = (await readManagedFile(root, lease, path)).revision;
        let injected = false;
        setFilesystemFaultInjectorForTests((current, target) => {
          if (injected || current !== event || target !== join(root.managedRoot, path.relativePath)) return;
          injected = true;
          throw new Error(`interrupted at ${event}`);
        });
        await expect(
          applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('intended'), expected: revision }]),
        ).rejects.toThrow(`interrupted at ${event}`);
        setFilesystemFaultInjectorForTests(undefined);
        expect(new TextDecoder().decode((await readManagedFile(root, lease, path)).bytes)).toBe('original');
      });
      expect(readdirSync(join(root.managedRoot, 'records'))).toEqual(['publication-crash.txt']);
    },
  );

  it.each([
    ['canonical temporary file', 'file-fsync', (target: string) => target.endsWith('.repository-store.tmp')],
    ['journal manifest', 'file-fsync', (target: string) => target.endsWith('manifest.json')],
    ['canonical directory', 'directory-fsync', () => true],
  ] as const)('returns exact durability evidence for %s fsync failures', async (_name, eventName, matches) => {
    const root = await fixture();
    const path = resolveManagedPath(root, `records/durable-${eventName}.txt`);
    const cause = new Error(`injected ${eventName} failure`);
    let failedPath = '';
    await withRepositoryLease(root, async (lease) => {
      setFilesystemFaultInjectorForTests((event, target) => {
        if (event === eventName && matches(target)) {
          failedPath = target;
          throw cause;
        }
      });
      let failure: unknown;
      try {
        await applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('value'), expected: 'absent' }]);
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toMatchObject({
        name: 'DurabilityError',
        code: 'FSYNC_FAILED',
        category: 'durability',
        cause,
        evidence: { operation: eventName, path: failedPath },
      } satisfies Partial<DurabilityError>);
      setFilesystemFaultInjectorForTests(undefined);
    });
    await withRepositoryLease(root, async () => undefined);
    expect(existsSync(join(root.managedRoot, path.relativePath))).toBe(false);
    expect(transactionEntries(root)).toEqual([]);
  });

  it('returns structured durability evidence for staged artifact fsync failures', async () => {
    const root = await fixture();
    const path = resolveManagedPath(root, 'records/durable.txt');
    const cause = new Error('injected fsync failure');
    setFilesystemFaultInjectorForTests((event, target) => {
      if (event === 'file-fsync' && target.endsWith('.stage')) throw cause;
    });
    await withRepositoryLease(root, async (lease) => {
      await expect(
        applyCanonicalBatch(root, lease, [{ kind: 'write', path, bytes: bytes('value'), expected: 'absent' }]),
      ).rejects.toMatchObject({
        name: 'DurabilityError',
        code: 'FSYNC_FAILED',
        category: 'durability',
        cause,
        evidence: { operation: 'file-fsync' },
      } satisfies Partial<DurabilityError>);
    });
    expect(existsSync(join(root.managedRoot, 'records/durable.txt'))).toBe(false);
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
      expect(publicationArtifacts(join(authority, 'records'))).toEqual([]);
    },
  );

  it.each(['before-exact-publication', 'exclusive-destination-published'] as const)(
    'recovers a SIGKILL %s without leaving publication artifacts',
    async (event) => {
      const authority = mkdtempSync(join(tmpdir(), `neottia-publication-crash-${event}-`));
      tempDirectories.push(authority);
      await runCrashWorker(authority, `filesystem:${event}`, 1);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
      const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
      await withRepositoryLease(root, async () => undefined, { staleMs: 1 });
      expect(readFileSync(join(authority, 'records/first.txt'), 'utf8')).toBe('original-first');
      expect(publicationArtifacts(join(authority, 'records'))).toEqual([]);
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
  it('fails native-unavailable acquisition before creating claim or lease artifacts', async () => {
    const root = await fixture();
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    setNativePublicationBackendForTests(null);
    await expect(withRepositoryLease(root, async () => undefined)).rejects.toMatchObject({
      category: 'config',
      code: 'UNSUPPORTED_RUNTIME',
    });
    expect(existsSync(join(control, 'authority.claim'))).toBe(false);
    expect(existsSync(join(control, 'authority.lease'))).toBe(false);
  });

  it('removes only an expected stale release entry when a new owner blocks restoration', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const lockPath = join(control, 'authority.lease');
    const staleToken = randomBytes(32).toString('hex');
    const releasePath = `${lockPath}.release-${staleToken}`;
    mkdirSync(releasePath);
    const staleOwnerPath = join(releasePath, 'owner.json');
    writeOwnerMetadata(staleOwnerPath, control, process.pid, new Date(), staleToken);
    const expected = {
      kind: 'directory' as const,
      identity: lstatSync(releasePath),
      ownerIdentity: lstatSync(staleOwnerPath),
      token: staleToken,
    };
    const currentToken = randomBytes(32).toString('hex');
    mkdirSync(lockPath);
    writeOwnerMetadata(join(lockPath, 'owner.json'), control, process.pid, new Date(), currentToken);

    restoreQuarantinedLease(releasePath, lockPath, expected);

    expect(existsSync(releasePath)).toBe(false);
    expect(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8')).token).toBe(currentToken);
  });

  it('restores a verified release identity when the destination remains absent', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const lockPath = join(control, 'authority.lease');
    const token = randomBytes(32).toString('hex');
    const releasePath = `${lockPath}.release-${token}`;
    mkdirSync(releasePath);
    const ownerPath = join(releasePath, 'owner.json');
    writeOwnerMetadata(ownerPath, control, process.pid, new Date(), token);
    const expected = {
      kind: 'directory' as const,
      identity: lstatSync(releasePath),
      ownerIdentity: lstatSync(ownerPath),
      token,
    };

    restoreQuarantinedLease(releasePath, lockPath, expected);

    expect(existsSync(releasePath)).toBe(false);
    expect(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8')).token).toBe(token);
  });

  it('preserves a same-token release replacement whose identity was not expected', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const lockPath = join(control, 'authority.lease');
    const token = randomBytes(32).toString('hex');
    const releasePath = `${lockPath}.release-${token}`;
    mkdirSync(releasePath);
    const ownerPath = join(releasePath, 'owner.json');
    writeOwnerMetadata(ownerPath, control, process.pid, new Date(), token);
    const expected = {
      kind: 'directory' as const,
      identity: lstatSync(releasePath),
      ownerIdentity: lstatSync(ownerPath),
      token,
    };
    renameSync(releasePath, `${releasePath}.displaced`);
    mkdirSync(releasePath);
    writeOwnerMetadata(join(releasePath, 'owner.json'), control, process.pid, new Date(), token);
    mkdirSync(lockPath);
    writeOwnerMetadata(join(lockPath, 'owner.json'), control, process.pid, new Date());

    restoreQuarantinedLease(releasePath, lockPath, expected);

    expect(existsSync(releasePath)).toBe(true);
    expect(JSON.parse(readFileSync(join(releasePath, 'owner.json'), 'utf8')).token).toBe(token);
  });

  it('does not restore a substituted release identity to an absent lease path', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const lockPath = join(control, 'authority.lease');
    const token = randomBytes(32).toString('hex');
    const releasePath = `${lockPath}.release-${token}`;
    mkdirSync(releasePath);
    const ownerPath = join(releasePath, 'owner.json');
    writeOwnerMetadata(ownerPath, control, process.pid, new Date(), token);
    const expected = {
      kind: 'directory' as const,
      identity: lstatSync(releasePath),
      ownerIdentity: lstatSync(ownerPath),
      token,
    };
    renameSync(releasePath, `${releasePath}.displaced`);
    mkdirSync(releasePath);
    writeOwnerMetadata(join(releasePath, 'owner.json'), control, process.pid, new Date(), token);

    restoreQuarantinedLease(releasePath, lockPath, expected);

    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(releasePath)).toBe(true);
    expect(JSON.parse(readFileSync(join(releasePath, 'owner.json'), 'utf8')).token).toBe(token);
  });

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

  it('serializes repeated real worker-process acquisitions under one repository authority', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-repository-workers-'));
    tempDirectories.push(authority);
    const workerIds = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
    const iterations = 12;
    await Promise.all(workerIds.map((id) => runLeaseWorker(authority, id, iterations)));
    const lines = readFileSync(join(authority, 'lease-trace.txt'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(workerIds.length * iterations * 2);
    for (let index = 0; index < lines.length; index += 2) {
      const id = lines[index]?.split(':')[0];
      expect(lines.slice(index, index + 2)).toEqual([`${id}:start`, `${id}:end`]);
    }
  }, 120_000);

  it('fails closed when the lease control root is rebound during owner verification', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const lock = writeTestOwner(control, process.pid, new Date());
    const ownerPath = join(lock, 'owner.json');
    const displacedControl = `${control}.operator`;
    const replacementTarget = join(root.authorityRoot, 'replacement-lease-target');
    mkdirSync(replacementTarget);
    writeFileSync(join(replacementTarget, 'marker'), 'operator-owned');
    let callbackEntered = false;
    let rebound = false;
    setFilesystemFaultInjectorForTests((event, target) => {
      if (rebound || event !== 'bounded-read-opened' || target !== ownerPath) return;
      rebound = true;
      renameSync(control, displacedControl);
      mkdirSync(control);
      symlinkSync(replacementTarget, join(control, 'authority.lease'), 'dir');
    });

    await expect(
      withRepositoryLease(root, async () => {
        callbackEntered = true;
      }),
    ).rejects.toMatchObject({ category: 'path_safety', code: 'IDENTITY_CHANGED' });
    expect(callbackEntered).toBe(false);
    expect(rebound).toBe(true);
    expect(lstatSync(join(control, 'authority.lease')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(replacementTarget, 'marker'), 'utf8')).toBe('operator-owned');
  });

  it('serializes independent same-process callers while retaining true nesting errors', async () => {
    const root = await fixture();
    const order: string[] = [];
    let releaseFirst = (): void => undefined;
    const firstGate = new Promise<void>((resolveGate) => {
      releaseFirst = resolveGate;
    });
    const first = withRepositoryLease(root, async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    await waitForCondition(() => order.includes('first:start'));
    const second = withRepositoryLease(root, async () => {
      order.push('second:start');
      order.push('second:end');
    });
    // The second call reaches the synchronous queue before returning its promise.
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('bounds lease host metadata before decoding', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const hostId = join(root.authorityRoot, '.neottia', 'repository-store', 'host-id');
    writeFileSync(hostId, 'x'.repeat(4 * 1024 + 1));
    await expect(withRepositoryLease(root, async () => undefined)).rejects.toBeInstanceOf(ResourceLimitError);
  });

  it.each(['symlink', 'hardlink'] as const)(
    'rejects unsafe %s host metadata without touching its target',
    async (kind) => {
      const root = await fixture();
      await withRepositoryLease(root, async () => undefined);
      const hostId = join(root.authorityRoot, '.neottia', 'repository-store', 'host-id');
      const target = join(root.authorityRoot, 'operator-host-id');
      writeFileSync(target, `${'a'.repeat(64)}\n`);
      rmSync(hostId);
      if (kind === 'symlink') symlinkSync(target, hostId);
      else linkSync(target, hostId);
      await expect(withRepositoryLease(root, async () => undefined)).rejects.toMatchObject({
        code: kind === 'symlink' ? 'UNSAFE_LINK' : 'UNSAFE_HARD_LINK',
      });
      expect(readFileSync(target, 'utf8')).toBe(`${'a'.repeat(64)}\n`);
    },
  );

  it.each(['owner.json', 'authority.claim'] as const)(
    'bounds direct %s lease metadata before decoding',
    async (artifact) => {
      const root = await fixture();
      await withRepositoryLease(root, async () => undefined);
      const control = join(root.authorityRoot, '.neottia', 'repository-store');
      const path = artifact === 'owner.json' ? join(control, 'authority.lease', artifact) : join(control, artifact);
      if (artifact === 'owner.json') mkdirSync(join(control, 'authority.lease'));
      writeFileSync(path, 'x'.repeat(4 * 1024 + 1));
      utimesSync(artifact === 'owner.json' ? join(control, 'authority.lease') : path, new Date(0), new Date(0));
      await expect(withRepositoryLease(root, async () => undefined, { staleMs: 1 })).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      });
    },
  );

  it.each([
    ['owner.json', 'symlink'],
    ['owner.json', 'hardlink'],
    ['authority.claim', 'symlink'],
    ['authority.claim', 'hardlink'],
  ] as const)('rejects a direct %s %s without deleting its target', async (artifact, kind) => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const target = join(root.authorityRoot, `operator-${artifact}-${kind}`);
    writeOwnerMetadata(target, control, 16_777_215, new Date(0));
    const path = artifact === 'owner.json' ? join(control, 'authority.lease', artifact) : join(control, artifact);
    if (artifact === 'owner.json') mkdirSync(join(control, 'authority.lease'));
    if (kind === 'symlink') symlinkSync(target, path);
    else linkSync(target, path);
    utimesSync(artifact === 'owner.json' ? join(control, 'authority.lease') : path, new Date(0), new Date(0));
    await expect(withRepositoryLease(root, async () => undefined, { staleMs: 1 })).rejects.toMatchObject({
      code: kind === 'symlink' ? 'UNSAFE_LINK' : 'UNSAFE_HARD_LINK',
    });
    expect(readFileSync(target, 'utf8')).toContain('"version":1');
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

  it('preserves a same-token claim substituted immediately before quarantine', async () => {
    const root = await fixture();
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const claim = join(control, 'authority.claim');
    let substituted = false;
    setFilesystemFaultInjectorForTests((event, target) => {
      if (event !== 'before-lease-artifact-quarantine' || target !== claim || substituted) return;
      substituted = true;
      const owner = readFileSync(claim);
      renameSync(claim, `${claim}.operator`);
      writeFileSync(claim, owner);
    });
    await expect(withRepositoryLease(root, async () => undefined)).rejects.toMatchObject({
      code: 'LEASE_OWNER_UNKNOWN',
    });
    expect(readFileSync(claim, 'utf8')).toContain('"token"');
    expect(readFileSync(`${claim}.operator`, 'utf8')).toContain('"token"');
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

  it('preserves a fresh live same-token claim substituted after stale-owner verification', async () => {
    const root = await fixture();
    await withRepositoryLease(root, async () => undefined);
    const control = join(root.authorityRoot, '.neottia', 'repository-store');
    const claim = join(control, 'authority.claim');
    const token = randomUUID();
    writeOwnerMetadata(claim, control, 16_777_215, new Date(0), token);
    utimesSync(claim, new Date(0), new Date(0));
    let replacementBytes: Buffer | undefined;
    setFilesystemFaultInjectorForTests((event, target) => {
      if (event !== 'after-stale-claim-owner-verified' || target !== claim || replacementBytes !== undefined) return;
      renameSync(claim, `${claim}.stale-owner`);
      writeOwnerMetadata(claim, control, process.pid, new Date(), token);
      replacementBytes = readFileSync(claim);
    });

    await expect(
      withRepositoryLease(root, async () => undefined, { staleMs: 1, pollMs: 1, waitMs: 25 }),
    ).rejects.toMatchObject({ code: 'LEASE_BUSY' });
    expect(readFileSync(claim)).toEqual(replacementBytes);
    expect(existsSync(`${claim}.stale-owner`)).toBe(true);
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

function transactionEntries(root: Awaited<ReturnType<typeof fixture>>): string[] {
  const path = transactionRoot(root.authorityRoot, identityOf(root).managedRootId);
  return existsSync(path) ? readdirSync(path) : [];
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

function runLeaseWorker(authority: string, id: string, iterations: number): Promise<void> {
  const worker = fileURLToPath(new URL('./lease-worker.fixture.ts', import.meta.url));
  return runWorkerProcess(worker, [authority, id, String(iterations)], `lease worker ${id}`, (code) => code === 0);
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

function publicationArtifacts(directory: string): string[] {
  return readdirSync(directory).filter(
    (name) => name.endsWith('.repository-store.tmp') || name.endsWith('.repository-store.evacuated'),
  );
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (condition()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error('Test condition was not reached.');
}

function identityOf(root: Awaited<ReturnType<typeof fixture>>): { authorityId: string; managedRootId: string } {
  const state = getRootState(root);
  if (state === undefined) throw new Error('Test root has no internal state.');
  return state;
}
