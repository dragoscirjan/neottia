import type { ManagedPath } from '../internal/model.js';
import type { OperationControl } from '../lease.js';
import type { ByteRevision } from '../revision.js';

/** Exact optimistic canonical operation; blind overwrites are intentionally absent. */
export type CanonicalOperation =
  | {
      readonly kind: 'write';
      readonly path: ManagedPath;
      readonly bytes: Uint8Array;
      readonly expected: 'absent' | ByteRevision;
    }
  | {
      readonly kind: 'remove';
      readonly path: ManagedPath;
      readonly expected: ByteRevision;
    }
  | {
      readonly kind: 'move';
      readonly from: ManagedPath;
      readonly to: ManagedPath;
      readonly expectedSource: ByteRevision;
      readonly expectedDestination: 'absent' | ByteRevision;
    };

/** Canonical publication controls, including the domain-owned inventory roots. */
export interface ApplyCanonicalBatchOptions extends OperationControl {
  /** Defaults to the complete managed root when omitted. */
  readonly inventory?: readonly ManagedPath[];
}

/** Summary from an idempotent recovery pass. */
export interface RecoveryReport {
  readonly rolledBack: readonly string[];
  readonly cleanedPrepared: readonly string[];
  readonly cleanedCommitted: readonly string[];
}

/** One normalized path transition persisted in a transaction manifest. */
export interface JournalEntry {
  readonly path: string;
  readonly originalRevision: ByteRevision | null;
  readonly intendedRevision: ByteRevision | null;
  readonly beforeArtifact: string | null;
  readonly stagedArtifact: string | null;
  readonly bytes: number;
}

/** Canonical bounded journal representation. */
export interface JournalManifest {
  readonly version: 1;
  readonly transactionId: string;
  readonly authorityId: string;
  readonly managedRootId: string;
  readonly entries: readonly JournalEntry[];
  readonly createdAt: string;
  readonly digest: string;
}
