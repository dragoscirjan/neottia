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

let transactionFaultInjector: ((event: TransactionFaultEvent, occurrence: number) => void) | undefined;
let leaseFaultInjector: ((event: LeaseFaultEvent) => void) | undefined;
const occurrences = new Map<TransactionFaultEvent, number>();

/** Installs a process-local test seam; this module is not package-exported. */
export function setTransactionFaultInjectorForTests(
  injector: ((event: TransactionFaultEvent, occurrence: number) => void) | undefined,
): void {
  occurrences.clear();
  transactionFaultInjector = injector;
}

/** Reports one named state boundary and its one-based occurrence. */
export function emitTransactionFault(event: TransactionFaultEvent): void {
  const occurrence = (occurrences.get(event) ?? 0) + 1;
  occurrences.set(event, occurrence);
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
