import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { LeaseContentionError, PathSafetyError, RepositoryStoreConfigError } from './errors.js';
import { emitLeaseFault } from './internal/fault-injection.js';
import {
  assertSafeRegular,
  ensurePrivateDirectory,
  hasCode,
  sameIdentity,
  syncDirectory,
} from './internal/filesystem.js';
import {
  createRepositoryLease,
  getLeaseState,
  getRootState,
  type LeaseState,
  type ManagedRoot,
  type RepositoryLease,
} from './internal/model.js';

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

const activeAuthorities = new Set<string>();
const DEFAULT_STALE_MS = 60_000;
const DEFAULT_POLL_MS = 20;
const DEFAULT_WAIT_MS = 10_000;

/** Holds the sole authority lease across awaited work and performs recovery first. */
export async function withRepositoryLease<T>(
  root: ManagedRoot,
  operation: (lease: RepositoryLease) => Promise<T>,
  options: RepositoryLeaseOptions = {},
): Promise<T> {
  const rootState = getRootState(root);
  if (rootState === undefined) throw new RepositoryStoreConfigError('Managed root is not a repository-store handle.');
  if (activeAuthorities.has(rootState.authorityId))
    throw new LeaseContentionError('Repository lease acquisition is non-reentrant.', 'LEASE_REENTRANT');
  checkControl(options);
  const staleMs = positiveInteger(options.staleMs ?? DEFAULT_STALE_MS, 'staleMs');
  const pollMs = positiveInteger(options.pollMs ?? DEFAULT_POLL_MS, 'pollMs');
  const deadline = options.deadline ?? Date.now() + nonnegativeInteger(options.waitMs ?? DEFAULT_WAIT_MS, 'waitMs');
  const controlRoot = join(rootState.authorityRoot, '.neottia', 'repository-store');
  ensurePrivateDirectory(controlRoot);
  const hostId = ensureHostId(controlRoot);
  const lockPath = join(controlRoot, 'authority.lease');
  const claimPath = join(controlRoot, 'authority.claim');
  const token = randomBytes(32).toString('hex');

  activeAuthorities.add(rootState.authorityId);
  let acquired = false;
  let lockIdentity: Stats | undefined;
  let ownerIdentity: Stats | undefined;
  let leaseState: LeaseState | undefined;
  try {
    while (!acquired) {
      checkControl({ ...options, deadline });
      if (!acquireClaim(claimPath, controlRoot, token, hostId)) {
        if (tryReclaimClaim(claimPath, lockPath, controlRoot, hostId, staleMs)) continue;
        await waitForLeasePoll(pollMs, deadline, options);
        continue;
      }
      let initializingLock: Stats | undefined;
      try {
        try {
          mkdirSync(lockPath, { mode: 0o700 });
          initializingLock = lstatSync(lockPath);
          emitLeaseFault('lease-directory-created');
        } catch (error: unknown) {
          if (!hasCode(error, 'EEXIST')) throw error;
          if (tryReclaimLockedLease(lockPath, controlRoot, hostId, staleMs)) continue;
          await waitForLeasePoll(pollMs, deadline, options);
          continue;
        }
        writeOwner(lockPath, ownerMetadata(token, hostId));
        emitLeaseFault('lease-owner-written');
        lockIdentity = lstatSync(lockPath);
        if (!lockIdentity.isDirectory() || lockIdentity.isSymbolicLink())
          throw new PathSafetyError('Unsafe repository lease path.');
        ownerIdentity = lstatSync(join(lockPath, 'owner.json'));
        assertSafeRegular(ownerIdentity, join(lockPath, 'owner.json'));
        syncDirectory(controlRoot);
        if (!removeOwnedClaim(claimPath, token)) {
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
        if (!acquired) removeOwnedClaim(claimPath, token);
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
    // A static import would create a lease/recovery initialization cycle.
    const { recoverCanonicalTransactions } = await import('./transaction/recovery.js');
    await recoverCanonicalTransactions(root, lease, options);
    return await operation(lease);
  } finally {
    if (leaseState !== undefined) leaseState.active = false;
    if (acquired && lockIdentity !== undefined && ownerIdentity !== undefined)
      releaseOwnedLease(lockPath, controlRoot, token, lockIdentity, ownerIdentity);
    activeAuthorities.delete(rootState.authorityId);
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

function writeOwner(directory: string, owner: OwnerMetadata): void {
  writeOwnerFile(join(directory, 'owner.json'), owner);
  syncDirectory(directory);
}

function writeOwnerFile(path: string, owner: OwnerMetadata): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
    fsyncSync(descriptor);
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
    const stat = lstatSync(path);
    assertSafeRegular(stat, path);
    const value = readFileSync(path, 'utf8').trim();
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
      fsyncSync(descriptor);
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
  try {
    const ownerPath = join(lockPath, 'owner.json');
    const owner = readOwner(ownerPath);
    const lockStat = lstatSync(lockPath);
    const ownerStat = lstatSync(ownerPath);
    if (!lockStat.isDirectory() || lockStat.isSymbolicLink())
      throw new PathSafetyError('Unsafe repository lease path.');
    if (Date.now() - lockStat.mtimeMs < staleMs || !conclusivelyDead(owner, hostId)) return false;
    const quarantine = `${lockPath}.release-${owner.token}`;
    renameSync(lockPath, quarantine);
    if (!quarantinedLeaseIdentityMatches(quarantine, owner.token, lockStat, ownerStat)) {
      restoreQuarantinedLease(quarantine, lockPath);
      throw new LeaseContentionError('Stale lease identity changed during reclamation.', 'LEASE_OWNER_UNKNOWN');
    }
    rmSync(join(quarantine, 'owner.json'));
    rmdirSync(quarantine);
    syncDirectory(controlRoot);
    return true;
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return !existsSync(lockPath);
    if (error instanceof PathSafetyError) throw error;
    return false;
  }
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
  try {
    const preliminary = lstatSync(claimPath);
    if (preliminary.isSymbolicLink() || !preliminary.isFile() || (preliminary.nlink !== 1 && preliminary.nlink !== 2))
      throw new PathSafetyError('Unsafe repository claim artifact.', 'UNSAFE_HARD_LINK');
    if (Date.now() - preliminary.mtimeMs < staleMs) return false;
    const owner = readOwner(claimPath, true);
    if (!conclusivelyDead(owner, hostId)) return false;
    normalizeInterruptedClaimLink(claimPath, controlRoot);
    const stat = lstatSync(claimPath);
    assertSafeRegular(stat, claimPath);
    cleanupInterruptedInitialization(lockPath, controlRoot, owner, staleMs);
    const quarantine = `${claimPath}.release-${owner.token}`;
    renameSync(claimPath, quarantine);
    if (!ownerTokenMatches(quarantine, owner.token)) {
      restoreQuarantinedLease(quarantine, claimPath);
      return false;
    }
    rmSync(quarantine);
    syncDirectory(controlRoot);
    return true;
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return true;
    if (error instanceof PathSafetyError) throw error;
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
  renameSync(lockPath, quarantine);
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
    renameSync(lockPath, quarantine);
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
      assertSafeRegular(lstatSync(ownerPath), ownerPath);
      rmSync(ownerPath);
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

function readOwner(path: string, allowInterruptedClaimLink = false): OwnerMetadata {
  const stat = lstatSync(path);
  if (allowInterruptedClaimLink) {
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.nlink !== 1 && stat.nlink !== 2))
      throw new PathSafetyError('Unsafe interrupted repository claim.', 'UNSAFE_HARD_LINK');
  } else {
    assertSafeRegular(stat, path);
  }
  const owner = JSON.parse(readFileSync(path, 'utf8')) as Partial<OwnerMetadata>;
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
  return owner as OwnerMetadata;
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
    if (!ownedLeaseIdentityMatches(lockPath, token, lockIdentity, ownerIdentity)) return;
    renameSync(lockPath, releasePath);
    if (!quarantinedLeaseIdentityMatches(releasePath, token, lockIdentity, ownerIdentity)) {
      restoreQuarantinedLease(releasePath, lockPath);
      return;
    }
    rmSync(join(releasePath, 'owner.json'));
    rmdirSync(releasePath);
    syncDirectory(controlRoot);
  } catch {
    // Fail closed: uncertain ownership remains for stale-owner inspection.
  }
}

/** Restores a directory moved during a token race without overwriting a new owner. */
function restoreQuarantinedLease(quarantine: string, lockPath: string): void {
  try {
    renameSync(quarantine, lockPath);
  } catch {
    // Both paths are preserved when another owner already acquired lockPath.
  }
}

function removeOwnedClaim(path: string, token: string): boolean {
  try {
    if (!ownerTokenMatches(path, token)) return false;
    rmSync(path);
    return true;
  } catch {
    // A substituted claim is preserved.
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
    const currentOwner = lstatSync(join(lockPath, 'owner.json'));
    if (
      !currentLock.isDirectory() ||
      currentLock.isSymbolicLink() ||
      !sameLeaseIdentity(lockIdentity, currentLock) ||
      !sameLeaseIdentity(ownerIdentity, currentOwner)
    )
      return false;
    return ownerTokenMatches(join(lockPath, 'owner.json'), token);
  } catch {
    return false;
  }
}

function quarantinedLeaseIdentityMatches(
  releasePath: string,
  token: string,
  lockIdentity: Stats,
  ownerIdentity: Stats,
): boolean {
  try {
    const currentLock = lstatSync(releasePath);
    const currentOwner = lstatSync(join(releasePath, 'owner.json'));
    return (
      currentLock.isDirectory() &&
      !currentLock.isSymbolicLink() &&
      sameIdentity(lockIdentity, currentLock) &&
      sameLeaseIdentity(ownerIdentity, currentOwner) &&
      ownerTokenMatches(join(releasePath, 'owner.json'), token)
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

function ownerTokenMatches(path: string, token: string): boolean {
  try {
    const stat = lstatSync(path);
    assertSafeRegular(stat, path);
    const owner = JSON.parse(readFileSync(path, 'utf8')) as { token?: string };
    return owner.token === token;
  } catch {
    return false;
  }
}

async function waitForLeasePoll(pollMs: number, deadline: number, options: RepositoryLeaseOptions): Promise<void> {
  if (Date.now() >= deadline) throw new LeaseContentionError('Repository authority lease is busy.', 'LEASE_BUSY');
  await interruptibleDelay(Math.min(pollMs, Math.max(1, deadline - Date.now())), { ...options, deadline });
}

async function interruptibleDelay(ms: number, control: OperationControl): Promise<void> {
  checkControl(control);
  await new Promise<void>((resolveDelay, rejectDelay) => {
    const timer = setTimeout(done, ms);
    const deadlineTimer =
      control.deadline === undefined ? undefined : setTimeout(done, Math.max(0, control.deadline - Date.now()));
    function done(): void {
      clearTimeout(timer);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      control.signal?.removeEventListener('abort', aborted);
      resolveDelay();
    }
    function aborted(): void {
      clearTimeout(timer);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      control.signal?.removeEventListener('abort', aborted);
      rejectDelay(new LeaseContentionError('Repository operation was aborted.', 'ABORTED'));
    }
    control.signal?.addEventListener('abort', aborted, { once: true });
  });
  checkControl(control);
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
