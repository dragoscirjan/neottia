import { MemoryCancellationError } from './errors.js';

/**
 * Call-level cancellation controls accepted by every Memory store and backend
 * operation. `deadline` is absolute Unix epoch milliseconds, mirroring the
 * repository-store lease controls.
 */
export interface MemoryOperationControl {
  readonly signal?: AbortSignal;
  readonly deadline?: number;
}

/**
 * Throws a stable cancellation failure before any backend, lease, or cache
 * work. Called at every phase boundary where interruption is safe; the atomic
 * publication batch itself is never interrupted mid-flight.
 */
export function assertMemoryControl(control: MemoryOperationControl, label: string): void {
  if (control.signal?.aborted) throw new MemoryCancellationError(`${label} was aborted.`, 'ABORTED');
  if (control.deadline !== undefined && Date.now() >= control.deadline)
    throw new MemoryCancellationError(`${label} deadline was exceeded.`, 'DEADLINE_EXCEEDED');
}
