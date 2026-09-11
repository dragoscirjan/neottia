/** Named state-machine boundaries available only to crash tests. */
export const TRANSACTION_FAULT_EVENTS = [
  'prepare-directory-created',
  'before-image-written',
  'staged-artifact-written',
  'manifest-written',
  'prepare-directory-synced',
  'active-state-renamed',
  'active-state-synced',
  'canonical-path-published',
  'committed-state-renamed',
  'committed-state-synced',
  'cleanup-state-renamed',
  'cleanup-state-synced',
  'cleanup-artifact-removed',
  'cleanup-manifest-removed',
  'cleanup-directory-removed',
  'cleanup-root-synced',
] as const;

/** One injectable transition in the durable transaction state machine. */
export type TransactionFaultEvent = (typeof TRANSACTION_FAULT_EVENTS)[number];

/** Lease initialization boundaries used by real process-kill tests. */
export const LEASE_FAULT_EVENTS = [
  'claim-published',
  'claim-finalized',
  'lease-directory-created',
  'lease-owner-written',
  'lease-claim-removed',
] as const;

/** One injectable lease-initialization transition. */
export type LeaseFaultEvent = (typeof LEASE_FAULT_EVENTS)[number];

/** Filesystem boundaries used to reproduce path and durability races. */
export const FILESYSTEM_FAULT_EVENTS = [
  'bounded-read-opened',
  'before-exact-publication',
  'before-exact-removal',
  'before-exact-evacuation',
  'destination-evacuated',
  'exclusive-destination-published',
  'before-lease-artifact-quarantine',
  'after-stale-claim-owner-verified',
  'file-fsync',
  'directory-fsync',
] as const;

/** One injectable filesystem boundary. */
export type FilesystemFaultEvent = (typeof FILESYSTEM_FAULT_EVENTS)[number];

let transactionFaultInjector: ((event: TransactionFaultEvent, occurrence: number) => void) | undefined;
let leaseFaultInjector: ((event: LeaseFaultEvent) => void) | undefined;
let filesystemFaultInjector: ((event: FilesystemFaultEvent, path: string, occurrence: number) => void) | undefined;
const transactionOccurrences = new Map<TransactionFaultEvent, number>();
const filesystemOccurrences = new Map<string, number>();

/** Installs a process-local seam exposed only through the testing subpath. */
export function setTransactionFaultInjectorForTests(
  injector: ((event: TransactionFaultEvent, occurrence: number) => void) | undefined,
): void {
  transactionOccurrences.clear();
  transactionFaultInjector = injector;
}

/** Reports one named state boundary and its one-based occurrence. */
export function emitTransactionFault(event: TransactionFaultEvent): void {
  const occurrence = (transactionOccurrences.get(event) ?? 0) + 1;
  transactionOccurrences.set(event, occurrence);
  transactionFaultInjector?.(event, occurrence);
}

/** Installs the process-local lease crash-test seam. */
export function setLeaseFaultInjectorForTests(injector: ((event: LeaseFaultEvent) => void) | undefined): void {
  leaseFaultInjector = injector;
}

/** Reports one named lease initialization boundary. */
export function emitLeaseFault(event: LeaseFaultEvent): void {
  leaseFaultInjector?.(event);
}

/** Installs a process-local filesystem race/failure seam. */
export function setFilesystemFaultInjectorForTests(
  injector: ((event: FilesystemFaultEvent, path: string, occurrence: number) => void) | undefined,
): void {
  filesystemOccurrences.clear();
  filesystemFaultInjector = injector;
}

/** Reports one filesystem boundary with the affected path. */
export function emitFilesystemFault(event: FilesystemFaultEvent, path: string): void {
  const key = `${event}\0${path}`;
  const occurrence = (filesystemOccurrences.get(key) ?? 0) + 1;
  filesystemOccurrences.set(key, occurrence);
  filesystemFaultInjector?.(event, path, occurrence);
}
