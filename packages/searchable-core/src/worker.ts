import { type Worker } from 'node:worker_threads';

/** Result decoder used after a worker posts its one terminal message. */
export type WorkerMessageDecoder<T> = (message: unknown) => T;

/** Lifecycle controls for a single-message bounded worker. */
export interface BoundedWorkerOptions<T> {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly cancellationError: () => Error;
  readonly timeoutError: () => Error;
  readonly workerError: () => Error;
  readonly decode: WorkerMessageDecoder<T>;
}

/** Waits for one worker result and does not settle until termination completes. */
export function runBoundedWorker<T>(worker: Worker, options: BoundedWorkerOptions<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let claimed = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    };
    const settle = async (result: { readonly value: T } | { readonly error: unknown }) => {
      if (claimed) return;
      claimed = true;
      cleanup();
      try {
        await worker.terminate();
      } catch {
        reject(options.workerError());
        return;
      }
      if ('error' in result) reject(result.error);
      else resolve(result.value);
    };
    const cancel = () => void settle({ error: options.cancellationError() });
    const timer = setTimeout(() => void settle({ error: options.timeoutError() }), Math.max(1, options.timeoutMs));
    options.signal?.addEventListener('abort', cancel, { once: true });
    worker.once('message', (message: unknown) => {
      try {
        void settle({ value: options.decode(message) });
      } catch (error: unknown) {
        void settle({ error });
      }
    });
    worker.once('error', () => void settle({ error: options.workerError() }));
    worker.once('exit', () => {
      if (!claimed) void settle({ error: options.workerError() });
    });
    if (options.signal?.aborted) cancel();
  });
}
