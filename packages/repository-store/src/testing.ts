/** Test-only fault injection hooks for real crash and race fixtures. */
export {
  FILESYSTEM_FAULT_EVENTS,
  LEASE_FAULT_EVENTS,
  TRANSACTION_FAULT_EVENTS,
  setFilesystemFaultInjectorForTests,
  setLeaseFaultInjectorForTests,
  setTransactionFaultInjectorForTests,
  type FilesystemFaultEvent,
  type LeaseFaultEvent,
  type TransactionFaultEvent,
} from './internal/fault-injection.js';
