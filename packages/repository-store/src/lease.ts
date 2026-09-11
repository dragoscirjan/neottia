import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { LeaseContentionError, PathSafetyError, RepositoryStoreConfigError, ResourceLimitError } from './errors.js';
import { emitFilesystemFault, emitLeaseFault } from './internal/fault-injection.js';
import {
  assertSafeRegular,
  captureDirectories,
  ensurePrivateDirectory,
  hasCode,
  readRegularFile,
  readRegularFileWithIdentity,
  revalidateDirectories,
  sameIdentity,
  syncDirectory,
  syncFileDescriptor,
} from './internal/filesystem.js';
import {
  createRepositoryLease,
  getLeaseState,
  getRootState,
  type LeaseState,
  type ManagedRoot,
  type RepositoryLease,
} from './internal/model.js';
import {
  assertNativePublicationPath,
  nativeRenameNoReplace,
  requireNativePublicationBackend,
} from './internal/native-publication.js';

/** Abort and absolute wall-clock deadline controls accepted by async operations. */
export interface OperationControl {
  readonly signal?: AbortSignal;
  /** Absolute Unix epoch milliseconds. */
  readonly deadline?: number;
}

/** Lease acquisition controls. */
export interface RepositoryLeaseOptions extends OperationControl {
  readonly staleMs?: number;
  readonly pollMs?: number;
  /** Compatibility bound used only when no explicit deadline is supplied. */
  readonly waitMs?: number;
}

interface OwnerMetadata {
  readonly version: 1;
  readonly token: string;
  readonly pid: number;
  readonly acquiredAt: string;
  readonly hostname: string;
  readonly hostId: string;
  readonly runtime: string;
  readonly processStart?: string;
}

interface VerifiedOwner {
  readonly metadata: OwnerMetadata;
  readonly identity: Stats;
}

const authorityContext = new AsyncLocalStorage<ReadonlyMap<string, LeaseState>>();
const authorityQueueTails = new Map<string, Promise<void>>();
const DEFAULT_STALE_MS = 60_000;
const DEFAULT_POLL_MS = 20;
const DEFAULT_WAIT_MS = 10_000;
const MAX_LEASE_METADATA_BYTES = 4 * 1024;

/** Holds the sole authority lease across awaited work and performs recovery first. */
export async function withRepositoryLease<T>(
  root: ManagedRoot,
  operation: (lease: RepositoryLease) => Promise<T>,
  options: RepositoryLeaseOptions = {},
): Promise<T> {
  const rootState = getRootState(root);
  if (rootState === undefined) throw new RepositoryStoreConfigError('Managed root is not a repository-store handle.');
  const inherited = authorityContext.getStore()?.get(rootState.authorityId);
  if (inherited?.active === true)
    throw new LeaseContentionError('Repository lease acquisition is non-reentrant.', 'LEASE_REENTRANT');
  checkControl(options);
  const staleMs = positiveInteger(options.staleMs ?? DEFAULT_STALE_MS, 'staleMs');
  const pollMs = positiveInteger(options.pollMs ?? DEFAULT_POLL_MS, 'pollMs');
  const explicitDeadline = options.deadline;
  const deadline = explicitDeadline ?? Date.now() + nonnegativeInteger(options.waitMs ?? DEFAULT_WAIT_MS, 'waitMs');
  const turn = enqueueAuthority(rootState.authorityId);
  try {
    await waitForAuthorityTurn(turn.predecessor, deadline, explicitDeadline !== undefined, options.signal);
  } catch (error: unknown) {
    // Keep the cancelled slot in FIFO order, but do not make its caller wait.
    void turn.predecessor.finally(turn.release);
    throw error;
  }

  const controlRoot = join(rootState.authorityRoot, '.neottia', 'repository-store');
  let acquired = false;
  let lockIdentity: Stats | undefined;
  let ownerIdentity: Stats | undefined;
  let leaseState: LeaseState | undefined;
  let lockPath = '';
  let token = '';
  try {
    checkAcquisitionControl(deadline, explicitDeadline !== undefined, options.signal);
    ensurePrivateDirectory(controlRoot);
    // Every successful acquisition must later remove its claim and lease.
    // Prove that exact native cleanup is available before creating either.
    const cleanupBackend = requireNativePublicationBackend();
    assertNativePublicationPath(cleanupBackend, controlRoot);
    const hostId = ensureHostId(controlRoot);
    lockPath = join(controlRoot, 'authority.lease');
    const claimPath = join(controlRoot, 'authority.claim');
    token = randomBytes(32).toString('hex');
    while (!acquired) {
      checkAcquisitionControl(deadline, explicitDeadline !== undefined, options.signal);
      if (!acquireClaim(claimPath, controlRoot, token, hostId)) {
        if (tryReclaimClaim(claimPath, lockPath, controlRoot, hostId, staleMs)) continue;
        await waitForLeasePoll(pollMs, deadline, explicitDeadline !== undefined, options.signal);
        continue;
      }
      let initializingLock: Stats | undefined;
      let claimOwnershipUncertain = false;
      try {
        try {
          mkdirSync(lockPath, { mode: 0o700 });
          initializingLock = lstatSync(lockPath);
          emitLeaseFault('lease-directory-created');
        } catch (error: unknown) {
          if (!hasCode(error, 'EEXIST')) throw error;
          if (tryReclaimLockedLease(lockPath, controlRoot, hostId, staleMs)) continue;
          await waitForLeasePoll(pollMs, deadline, explicitDeadline !== undefined, options.signal);
          continue;
        }
        ownerIdentity = writeOwner(lockPath, ownerMetadata(token, hostId));
        emitLeaseFault('lease-owner-written');
        lockIdentity = lstatSync(lockPath);
        if (!lockIdentity.isDirectory() || lockIdentity.isSymbolicLink())
          throw new PathSafetyError('Unsafe repository lease path.');
        const ownerPath = join(lockPath, 'owner.json');
        const ownerAtPath = lstatSync(ownerPath);
        assertSafeRegular(ownerAtPath, ownerPath);
        if (!sameLeaseIdentity(ownerIdentity, ownerAtPath))
          throw new PathSafetyError('Repository lease owner changed during initialization.', 'IDENTITY_CHANGED');
        syncDirectory(controlRoot);
        if (!removeOwnedClaim(claimPath, token)) {
          claimOwnershipUncertain = true;
          releaseOwnedLease(lockPath, controlRoot, token, lockIdentity, ownerIdentity);
          throw new LeaseContentionError('Repository initialization claim ownership changed.', 'LEASE_OWNER_UNKNOWN');
        }
        emitLeaseFault('lease-claim-removed');
        acquired = true;
      } catch (error: unknown) {
        if (!acquired && initializingLock !== undefined)
          cleanupOwnedInitialization(lockPath, controlRoot, token, initializingLock);
        throw error;
      } finally {
        if (!acquired && !claimOwnershipUncertain) removeOwnedClaim(claimPath, token);
      }
    }

    if (lockIdentity === undefined || ownerIdentity === undefined)
      throw new LeaseContentionError('Repository lease identity was not initialized.', 'LEASE_OWNER_UNKNOWN');
    const acquiredState: LeaseState = {
      authorityId: rootState.authorityId,
      token,
      lockPath,
      lockIdentity,
      ownerIdentity,
      active: true,
    };
    leaseState = acquiredState;
    const lease = createRepositoryLease(rootState.authorityRoot, acquiredState);
    const context = new Map(authorityContext.getStore() ?? []);
    context.set(rootState.authorityId, acquiredState);
    return await authorityContext.run(context, async () => {
      // A static import avoids a lease/recovery initialization cycle.
      const { recoverCanonicalTransactions } = await import('./transaction/recovery.js');
      await recoverCanonicalTransactions(root, lease, options);
      return operation(lease);
    });
  } finally {
    if (leaseState !== undefined) leaseState.active = false;
    if (acquired && lockIdentity !== undefined && ownerIdentity !== undefined)
      releaseOwnedLease(lockPath, controlRoot, token, lockIdentity, ownerIdentity);
    turn.release();
  }
}

/** Validates that a live lease belongs to the supplied managed root. */
export function assertLiveLease(root: ManagedRoot, lease: RepositoryLease): void {
  const rootState = getRootState(root);
  const leaseState = getLeaseState(lease);
  if (rootState === undefined || leaseState === undefined || rootState.authorityId !== leaseState.authorityId)
    throw new RepositoryStoreConfigError('Lease and managed root have different authorities.', 'AUTHORITY_MISMATCH');
  if (!leaseState.active) throw new LeaseContentionError('Repository lease is no longer active.', 'LEASE_BUSY');
  if (
    !ownedLeaseIdentityMatches(leaseState.lockPath, leaseState.token, leaseState.lockIdentity, leaseState.ownerIdentity)
  ) {
    leaseState.active = false;
    throw new LeaseContentionError('Repository lease ownership changed.', 'LEASE_OWNER_UNKNOWN');
  }
}

/** Throws a structured cancellation/deadline error before I/O phases. */
export function checkControl(control: OperationControl): void {
  if (control.signal?.aborted) throw new LeaseContentionError('Repository operation was aborted.', 'ABORTED');
  if (control.deadline !== undefined && Date.now() >= control.deadline)
    throw new LeaseContentionError('Repository operation deadline was exceeded.', 'DEADLINE_EXCEEDED');
}

function writeOwner(directory: string, owner: OwnerMetadata): Stats {
  const identity = writeOwnerFile(join(directory, 'owner.json'), owner);
  syncDirectory(directory);
  return identity;
}

function writeOwnerFile(path: string, owner: OwnerMetadata): Stats {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
    syncFileDescriptor(descriptor, path);
    return fstatSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function ownerMetadata(token: string, hostId: string): OwnerMetadata {
  const processStart = readProcessStart(process.pid);
  return {
    version: 1,
    token,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    hostname: hostname(),
    hostId,
    runtime: typeof Bun === 'undefined' ? `node:${process.version}` : `bun:${Bun.version}`,
    ...(processStart === undefined ? {} : { processStart }),
  };
}

// Declaring only the runtime marker avoids a build-time dependency on Bun types.
declare const Bun: undefined | { readonly version: string };

function ensureHostId(controlRoot: string): string {
  const path = join(controlRoot, 'host-id');
  try {
    const value = new TextDecoder().decode(readRegularFile(path, MAX_LEASE_METADATA_BYTES)).trim();
    if (!/^[0-9a-f]{64}$/u.test(value)) throw new PathSafetyError('Repository host-id is malformed.');
    return value;
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  const value = randomBytes(32).toString('hex');
  try {
    const descriptor = openSync(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    try {
      writeFileSync(descriptor, `${value}\n`);
      syncFileDescriptor(descriptor, path);
    } finally {
      closeSync(descriptor);
    }
    syncDirectory(controlRoot);
    return value;
  } catch (error: unknown) {
    if (!hasCode(error, 'EEXIST')) throw error;
    return ensureHostId(controlRoot);
  }
}

function tryReclaimLockedLease(lockPath: string, controlRoot: string, hostId: string, staleMs: number): boolean {
  const controlDirectories = captureDirectories(controlRoot);
  try {
    const ownerPath = join(lockPath, 'owner.json');
    const verifiedOwner = readOwner(ownerPath);
    const owner = verifiedOwner.metadata;
    const lockStat = lstatSync(lockPath);
    const ownerStat = verifiedOwner.identity;
    if (!lockStat.isDirectory() || lockStat.isSymbolicLink())
      throw new PathSafetyError('Unsafe repository lease path.');
    if (Date.now() - lockStat.mtimeMs < staleMs || !conclusivelyDead(owner, hostId)) return false;
    const quarantine = `${lockPath}.release-${owner.token}`;
    if (!quarantineNoReplace(lockPath, quarantine)) return false;
    const quarantinedOwnerPath = join(quarantine, 'owner.json');
    const movedOwner = readOwner(quarantinedOwnerPath);
    const movedLock = lstatSync(quarantine);
    if (
      !sameIdentity(lockStat, movedLock) ||
      !sameLeaseIdentity(ownerStat, movedOwner.identity) ||
      movedOwner.metadata.token !== owner.token
    ) {
      restoreQuarantinedLease(quarantine, lockPath);
      throw new LeaseContentionError('Stale lease identity changed during reclamation.', 'LEASE_OWNER_UNKNOWN');
    }
    if (!removeVerifiedOwnerFile(quarantinedOwnerPath, movedOwner)) {
      restoreQuarantinedLease(quarantine, lockPath);
      return false;
    }
    rmdirSync(quarantine);
    syncDirectory(controlRoot);
    return true;
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT') || (error instanceof PathSafetyError && error.code === 'IDENTITY_CHANGED'))
      return exactPathWasReleased(lockPath, controlDirectories, error);
    if (error instanceof PathSafetyError || error instanceof ResourceLimitError) throw error;
    return false;
  }
}

/** Proves exact release without accepting ancestor rebinding or path replacement. */
function exactPathWasReleased(
  path: string,
  controlDirectories: ReturnType<typeof captureDirectories>,
  originalError: unknown,
  failOnExistingIdentityChange = true,
): boolean {
  revalidateDirectories(controlDirectories);
  try {
    lstatSync(path);
  } catch (inspectionError: unknown) {
    if (hasCode(inspectionError, 'ENOENT')) {
      revalidateDirectories(controlDirectories);
      return true;
    }
    if (originalError instanceof PathSafetyError) throw originalError;
    throw inspectionError;
  }
  if (failOnExistingIdentityChange && originalError instanceof PathSafetyError) throw originalError;
  return false;
}

/** Publishes complete claim metadata atomically, eliminating ownerless claims. */
function acquireClaim(claimPath: string, controlRoot: string, token: string, hostId: string): boolean {
  const staging = `${claimPath}.prepare-${token}`;
  try {
    writeOwnerFile(staging, ownerMetadata(token, hostId));
    // A hard link is an atomic create-if-absent claim on the same filesystem.
    linkSync(staging, claimPath);
    emitLeaseFault('claim-published');
    rmSync(staging);
    syncDirectory(controlRoot);
    emitLeaseFault('claim-finalized');
    return true;
  } catch (error: unknown) {
    try {
      rmSync(staging);
    } catch {
      // Preserve an uncertain staging file; it never blocks acquisition.
    }
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  }
}

/** Reclaims a stale claim only when same-host owner death is conclusive. */
function tryReclaimClaim(
  claimPath: string,
  lockPath: string,
  controlRoot: string,
  hostId: string,
  staleMs: number,
): boolean {
  const controlDirectories = captureDirectories(controlRoot);
  try {
    const preliminary = lstatSync(claimPath);
    if (preliminary.isSymbolicLink())
      throw new PathSafetyError('Unsafe repository claim symbolic link.', 'UNSAFE_LINK');
    if (!preliminary.isFile() || (preliminary.nlink !== 1 && preliminary.nlink !== 2))
      throw new PathSafetyError('Unsafe repository claim artifact.', 'UNSAFE_HARD_LINK');
    const verifiedOwner = readOwner(claimPath, true);
    if (!sameIdentity(preliminary, verifiedOwner.identity))
      throw new LeaseContentionError('Claim identity changed before owner verification.', 'LEASE_OWNER_UNKNOWN');
    if (Date.now() - verifiedOwner.identity.mtimeMs < staleMs) return false;
    const owner = verifiedOwner.metadata;
    if (!conclusivelyDead(owner, hostId)) return false;
    emitFilesystemFault('after-stale-claim-owner-verified', claimPath);
    normalizeInterruptedClaimLink(claimPath, controlRoot);
    const normalizedOwner = readOwner(claimPath);
    if (
      !sameIdentity(preliminary, normalizedOwner.identity) ||
      !sameIdentity(verifiedOwner.identity, normalizedOwner.identity) ||
      normalizedOwner.metadata.token !== owner.token
    )
      throw new LeaseContentionError('Claim owner changed during reclamation.', 'LEASE_OWNER_UNKNOWN');
    cleanupInterruptedInitialization(lockPath, controlRoot, owner, staleMs);
    const quarantine = `${claimPath}.release-${owner.token}`;
    if (!quarantineNoReplace(claimPath, quarantine)) return false;
    const moved = readOwner(quarantine);
    if (!sameIdentity(normalizedOwner.identity, moved.identity) || moved.metadata.token !== owner.token) {
      restoreQuarantinedLease(quarantine, claimPath);
      return false;
    }
    rmSync(quarantine);
    syncDirectory(controlRoot);
    return true;
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT') || (error instanceof PathSafetyError && error.code === 'IDENTITY_CHANGED'))
      // A new contender claim can replace a released claim before inspection.
      // Preserve it as contention; unsafe persistent links still fail above.
      return exactPathWasReleased(claimPath, controlDirectories, error, false);
    if (error instanceof PathSafetyError || error instanceof ResourceLimitError) throw error;
    // Missing/malformed ownership is unknown and therefore remains locked.
    return false;
  }
}

/** Removes only an empty lock left by the conclusively dead claim owner. */
function cleanupInterruptedInitialization(
  lockPath: string,
  controlRoot: string,
  owner: OwnerMetadata,
  staleMs: number,
): void {
  let lockStat: Stats;
  try {
    lockStat = lstatSync(lockPath);
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return;
    throw error;
  }
  if (!lockStat.isDirectory() || lockStat.isSymbolicLink())
    throw new PathSafetyError('Unsafe incomplete repository lease path.');
  if (Date.now() - lockStat.mtimeMs < staleMs) return;
  try {
    readOwner(join(lockPath, 'owner.json'));
    return;
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT')) return;
  }
  if (readdirSync(lockPath).length !== 0) return;
  const quarantine = `${lockPath}.release-${owner.token}`;
  if (!quarantineNoReplace(lockPath, quarantine)) return;
  const quarantined = lstatSync(quarantine);
  if (!sameIdentity(lockStat, quarantined) || readdirSync(quarantine).length !== 0) {
    restoreQuarantinedLease(quarantine, lockPath);
    throw new LeaseContentionError('Incomplete lease identity changed during reclamation.', 'LEASE_OWNER_UNKNOWN');
  }
  rmdirSync(quarantine);
  syncDirectory(controlRoot);
}

/** Cleans an initialization failure while this process still owns its claim. */
function cleanupOwnedInitialization(lockPath: string, controlRoot: string, token: string, expectedLock: Stats): void {
  const quarantine = `${lockPath}.release-${token}`;
  try {
    const current = lstatSync(lockPath);
    if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(expectedLock, current)) return;
    if (!quarantineNoReplace(lockPath, quarantine)) return;
    const moved = lstatSync(quarantine);
    if (!sameIdentity(expectedLock, moved)) {
      restoreQuarantinedLease(quarantine, lockPath);
      return;
    }
    const entries = readdirSync(quarantine);
    if (entries.some((entry) => entry !== 'owner.json')) {
      restoreQuarantinedLease(quarantine, lockPath);
      return;
    }
    if (entries.includes('owner.json')) {
      const ownerPath = join(quarantine, 'owner.json');
      const owner = readOwner(ownerPath);
      if (owner.metadata.token !== token || !removeVerifiedOwnerFile(ownerPath, owner)) {
        restoreQuarantinedLease(quarantine, lockPath);
        return;
      }
    }
    rmdirSync(quarantine);
    syncDirectory(controlRoot);
  } catch {
    restoreQuarantinedLease(quarantine, lockPath);
  }
}

/** Completes cleanup after a crash between claim hard-link and staging unlink. */
function normalizeInterruptedClaimLink(claimPath: string, controlRoot: string): void {
  const claim = lstatSync(claimPath);
  if (!claim.isFile() || claim.isSymbolicLink() || claim.nlink === 1) return;
  if (claim.nlink !== 2) throw new PathSafetyError('Unsafe repository claim hard-link count.', 'UNSAFE_HARD_LINK');
  const prefix = `${basename(claimPath)}.prepare-`;
  const candidates = readdirSync(dirname(claimPath)).filter((name) => name.startsWith(prefix));
  const matching = candidates.filter((name) => {
    const suffix = name.slice(prefix.length);
    if (!/^[0-9a-f-]{32,64}$/u.test(suffix)) return false;
    const stat = lstatSync(join(dirname(claimPath), name));
    return stat.isFile() && !stat.isSymbolicLink() && sameIdentity(claim, stat);
  });
  if (matching.length !== 1) {
    // The publishing owner may have removed the staging link after our first
    // stat. A now-single-linked claim is already in its valid final state.
    const current = lstatSync(claimPath);
    if (current.nlink === 1 && sameIdentity(claim, current)) return;
    throw new PathSafetyError('Repository claim hard link is not package-owned.');
  }
  rmSync(join(dirname(claimPath), matching[0] as string));
  syncDirectory(controlRoot);
}

function conclusivelyDead(owner: OwnerMetadata, hostId: string): boolean {
  if (owner.hostname !== hostname() || owner.hostId !== hostId) return false;
  const currentStart = readProcessStart(owner.pid);
  if (owner.processStart !== undefined && currentStart !== undefined && owner.processStart !== currentStart)
    return true;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error: unknown) {
    return hasCode(error, 'ESRCH');
  }
}

function readProcessStart(pid: number): string | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').trim().split(/\s+/u);
    return fields[21];
  } catch {
    return undefined;
  }
}

function readOwner(path: string, allowInterruptedClaimLink = false): VerifiedOwner {
  const initialIdentity = allowInterruptedClaimLink ? lstatSync(path) : undefined;
  const stagingPeer = allowInterruptedClaimLink ? interruptedClaimPeer(path, initialIdentity) : undefined;
  let file: ReturnType<typeof readRegularFileWithIdentity>;
  try {
    file = readRegularFileWithIdentity(path, MAX_LEASE_METADATA_BYTES, {
      allowedLinkCounts: allowInterruptedClaimLink ? [1, 2] : [1],
    });
  } catch (error: unknown) {
    if (initialIdentity === undefined || !(error instanceof PathSafetyError) || error.code !== 'IDENTITY_CHANGED')
      throw error;
    const stabilized = lstatSync(path);
    if (
      stabilized.isSymbolicLink() ||
      !stabilized.isFile() ||
      stabilized.nlink !== 1 ||
      !sameIdentity(initialIdentity, stabilized)
    )
      throw error;
    // Retry only the legitimate staging-link finalization transition.
    file = readRegularFileWithIdentity(path, MAX_LEASE_METADATA_BYTES);
  }
  const owner = JSON.parse(new TextDecoder().decode(file.bytes)) as Partial<OwnerMetadata>;
  if (
    owner.version !== 1 ||
    typeof owner.token !== 'string' ||
    !/^[0-9a-f-]{32,64}$/u.test(owner.token) ||
    !Number.isSafeInteger(owner.pid) ||
    typeof owner.acquiredAt !== 'string' ||
    typeof owner.hostname !== 'string' ||
    typeof owner.hostId !== 'string' ||
    typeof owner.runtime !== 'string'
  )
    throw new Error('Malformed lease owner.');
  const finalIdentity = allowInterruptedClaimLink ? lstatSync(path) : undefined;
  if (finalIdentity !== undefined && !sameIdentity(file.identity, finalIdentity))
    throw new PathSafetyError('Interrupted claim identity changed after owner verification.', 'IDENTITY_CHANGED');
  const finalStagingPeer =
    allowInterruptedClaimLink && finalIdentity !== undefined ? interruptedClaimPeer(path, finalIdentity) : undefined;
  if ([stagingPeer, finalStagingPeer].some((peer) => peer !== undefined && owner.token !== peer.token))
    throw new PathSafetyError('Interrupted claim token does not match its package-owned staging link.');
  return { metadata: owner as OwnerMetadata, identity: file.identity };
}

/** Returns the sole package-owned staging peer for an interrupted claim. */
function interruptedClaimPeer(path: string, observed?: Stats): { readonly token: string } | undefined {
  const stat = observed ?? lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.nlink !== 1 && stat.nlink !== 2))
    throw new PathSafetyError('Unsafe interrupted repository claim.', 'UNSAFE_HARD_LINK');
  if (stat.nlink === 1) return undefined;
  const prefix = `${basename(path)}.prepare-`;
  const peers = readdirSync(dirname(path)).flatMap((name) => {
    if (!name.startsWith(prefix)) return [];
    const token = name.slice(prefix.length);
    if (!/^[0-9a-f-]{32,64}$/u.test(token)) return [];
    try {
      const peer = lstatSync(join(dirname(path), name));
      return peer.isFile() && !peer.isSymbolicLink() && sameIdentity(stat, peer) ? [{ token }] : [];
    } catch (error: unknown) {
      // acquireClaim removes its staging name immediately after publication.
      if (hasCode(error, 'ENOENT')) return [];
      throw error;
    }
  });
  if (peers.length === 1) return peers[0];

  // A legitimate publisher can unlink the sole staging peer between the
  // claim's nlink observation and directory scan. Accept only that stabilized
  // transition: the claim must still be the same regular inode with one link.
  const stabilized = lstatSync(path);
  if (!stabilized.isSymbolicLink() && stabilized.isFile() && stabilized.nlink === 1 && sameIdentity(stat, stabilized))
    return undefined;
  throw new PathSafetyError('Interrupted claim hard link is not package-owned.', 'UNSAFE_HARD_LINK');
}

function releaseOwnedLease(
  lockPath: string,
  controlRoot: string,
  token: string,
  lockIdentity: Stats,
  ownerIdentity: Stats,
): void {
  const releasePath = `${lockPath}.release-${token}`;
  try {
    const currentLock = lstatSync(lockPath);
    const currentOwner = readOwner(join(lockPath, 'owner.json'));
    if (
      !currentLock.isDirectory() ||
      currentLock.isSymbolicLink() ||
      !sameLeaseIdentity(lockIdentity, currentLock) ||
      !sameLeaseIdentity(ownerIdentity, currentOwner.identity) ||
      currentOwner.metadata.token !== token
    )
      return;
    if (!quarantineNoReplace(lockPath, releasePath)) return;
    const movedLock = lstatSync(releasePath);
    const movedOwnerPath = join(releasePath, 'owner.json');
    const movedOwner = readOwner(movedOwnerPath);
    if (
      !sameIdentity(lockIdentity, movedLock) ||
      !sameLeaseIdentity(ownerIdentity, movedOwner.identity) ||
      movedOwner.metadata.token !== token
    ) {
      restoreQuarantinedLease(releasePath, lockPath);
      return;
    }
    if (!removeVerifiedOwnerFile(movedOwnerPath, movedOwner)) {
      restoreQuarantinedLease(releasePath, lockPath);
      return;
    }
    rmdirSync(releasePath);
    syncDirectory(controlRoot);
  } catch {
    // Fail closed: uncertain ownership remains for stale-owner inspection.
  }
}

/** Restores a directory moved during a token race without overwriting a new owner. */
function restoreQuarantinedLease(quarantine: string, lockPath: string): void {
  try {
    nativeRenameNoReplace(requireNativePublicationBackend(), quarantine, lockPath);
  } catch {
    // Both paths are preserved when another owner already acquired lockPath.
  }
}

function removeOwnedClaim(path: string, token: string): boolean {
  try {
    const expected = readOwner(path);
    if (expected.metadata.token !== token) return false;
    const quarantine = `${path}.release-${token}`;
    if (!quarantineNoReplace(path, quarantine)) return false;
    const moved = readOwner(quarantine);
    if (moved.metadata.token !== token || !sameIdentity(expected.identity, moved.identity)) {
      restoreQuarantinedLease(quarantine, path);
      return false;
    }
    rmSync(quarantine);
    return true;
  } catch {
    // A substituted claim and every uncertain quarantine are preserved.
    return false;
  }
}

function ownedLeaseIdentityMatches(
  lockPath: string,
  token: string,
  lockIdentity: Stats,
  ownerIdentity: Stats,
): boolean {
  try {
    const currentLock = lstatSync(lockPath);
    const currentOwner = readOwner(join(lockPath, 'owner.json'));
    return (
      currentLock.isDirectory() &&
      !currentLock.isSymbolicLink() &&
      sameLeaseIdentity(lockIdentity, currentLock) &&
      sameLeaseIdentity(ownerIdentity, currentOwner.identity) &&
      currentOwner.metadata.token === token
    );
  } catch {
    return false;
  }
}

function sameLeaseIdentity(left: Stats, right: Stats): boolean {
  return (
    sameIdentity(left, right) &&
    left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.mtimeMs === right.mtimeMs
  );
}

function removeVerifiedOwnerFile(path: string, expected: VerifiedOwner): boolean {
  const quarantine = `${path}.release-${expected.metadata.token}`;
  if (!quarantineNoReplace(path, quarantine)) return false;
  try {
    const moved = readOwner(quarantine);
    if (moved.metadata.token !== expected.metadata.token || !sameIdentity(moved.identity, expected.identity)) {
      restoreQuarantinedLease(quarantine, path);
      return false;
    }
    rmSync(quarantine);
    return true;
  } catch {
    restoreQuarantinedLease(quarantine, path);
    return false;
  }
}

interface AuthorityTurn {
  readonly predecessor: Promise<void>;
  readonly release: () => void;
}

/** Adds one non-rejecting FIFO slot for an authority. */
function enqueueAuthority(authorityId: string): AuthorityTurn {
  const predecessor = authorityQueueTails.get(authorityId) ?? Promise.resolve();
  let releaseGate = (): void => undefined;
  const gate = new Promise<void>((resolveGate) => {
    releaseGate = resolveGate;
  });
  const tail = predecessor.then(() => gate);
  authorityQueueTails.set(authorityId, tail);
  let released = false;
  return {
    predecessor,
    release() {
      if (released) return;
      released = true;
      releaseGate();
      if (authorityQueueTails.get(authorityId) === tail) authorityQueueTails.delete(authorityId);
    },
  };
}

async function waitForAuthorityTurn(
  predecessor: Promise<void>,
  deadline: number,
  hasExplicitDeadline: boolean,
  signal?: AbortSignal,
): Promise<void> {
  checkAcquisitionControl(deadline, hasExplicitDeadline, signal);
  await new Promise<void>((resolveTurn, rejectTurn) => {
    let settled = false;
    const timer = setTimeout(timedOut, Math.max(0, deadline - Date.now()));
    const settle = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      operation();
    };
    const aborted = (): void =>
      settle(() => rejectTurn(new LeaseContentionError('Repository operation was aborted.', 'ABORTED')));
    function timedOut(): void {
      settle(() => rejectTurn(acquisitionTimeout(hasExplicitDeadline)));
    }
    signal?.addEventListener('abort', aborted, { once: true });
    void predecessor.then(() => settle(resolveTurn));
  });
  checkAcquisitionControl(deadline, hasExplicitDeadline, signal);
}

async function waitForLeasePoll(
  pollMs: number,
  deadline: number,
  hasExplicitDeadline: boolean,
  signal?: AbortSignal,
): Promise<void> {
  checkAcquisitionControl(deadline, hasExplicitDeadline, signal);
  await interruptibleDelay(Math.min(pollMs, Math.max(1, deadline - Date.now())), signal);
  checkAcquisitionControl(deadline, hasExplicitDeadline, signal);
}

async function interruptibleDelay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolveDelay, rejectDelay) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      signal?.removeEventListener('abort', aborted);
      resolveDelay();
    }
    function aborted(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      rejectDelay(new LeaseContentionError('Repository operation was aborted.', 'ABORTED'));
    }
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

function checkAcquisitionControl(deadline: number, hasExplicitDeadline: boolean, signal?: AbortSignal): void {
  if (signal?.aborted) throw new LeaseContentionError('Repository operation was aborted.', 'ABORTED');
  if (Date.now() >= deadline) throw acquisitionTimeout(hasExplicitDeadline);
}

function acquisitionTimeout(hasExplicitDeadline: boolean): LeaseContentionError {
  return hasExplicitDeadline
    ? new LeaseContentionError('Repository operation deadline was exceeded.', 'DEADLINE_EXCEEDED')
    : new LeaseContentionError('Repository authority lease is busy.', 'LEASE_BUSY');
}

function quarantineNoReplace(source: string, destination: string): boolean {
  emitFilesystemFault('before-lease-artifact-quarantine', source);
  try {
    const backend = requireNativePublicationBackend();
    assertNativePublicationPath(backend, dirname(source));
    nativeRenameNoReplace(backend, source, destination);
    return true;
  } catch (error: unknown) {
    if (hasCode(error, 'EEXIST') || hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RepositoryStoreConfigError(`${name} must be a positive safe integer.`);
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RepositoryStoreConfigError(`${name} must be a nonnegative safe integer.`);
  return value;
}

export type { RepositoryLease } from './internal/model.js';
