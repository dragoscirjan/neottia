import { EventEmitter } from 'node:events';
import { type Worker } from 'node:worker_threads';
import { expect, it, vi } from 'vitest';
import { runBoundedWorker } from './worker.js';

class FakeWorker extends EventEmitter {
  public readonly terminate = vi.fn<() => Promise<number>>();
}

function options(signal?: AbortSignal) {
  return {
    ...(signal === undefined ? {} : { signal }),
    timeoutMs: 1_000,
    cancellationError: () => new Error('cancelled'),
    timeoutError: () => new Error('timed out'),
    workerError: () => new Error('worker failed'),
    decode: (message: unknown) => String(message),
  };
}

it('waits for worker termination before returning a decoded result', async () => {
  const worker = new FakeWorker();
  let release: ((code: number) => void) | undefined;
  worker.terminate.mockReturnValue(
    new Promise<number>((resolve) => {
      release = resolve;
    }),
  );
  const result = runBoundedWorker(worker as unknown as Worker, options());
  let settled = false;
  void result.finally(() => {
    settled = true;
  });
  worker.emit('message', 'complete');
  worker.emit('exit', 1);
  await Promise.resolve();
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(settled).toBe(false);
  release?.(1);
  await expect(result).resolves.toBe('complete');
});

it('terminates a worker when cancellation already happened', async () => {
  const worker = new FakeWorker();
  worker.terminate.mockResolvedValue(1);
  const controller = new AbortController();
  controller.abort();
  const result = runBoundedWorker(worker as unknown as Worker, options(controller.signal));
  await expect(result).rejects.toThrow('cancelled');
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('settles cancellation once after termination finishes', async () => {
  const worker = new FakeWorker();
  worker.terminate.mockResolvedValue(1);
  const controller = new AbortController();
  const result = runBoundedWorker(worker as unknown as Worker, options(controller.signal));
  controller.abort();
  worker.emit('error', new Error('late failure'));
  await expect(result).rejects.toThrow('cancelled');
  expect(worker.terminate).toHaveBeenCalledOnce();
});
