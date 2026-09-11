import {
  DEFAULT_STORE_LIMITS,
  applyCanonicalBatch,
  computeByteRevision,
  resolveManagedPath,
  resolveManagedRoot,
  withRepositoryLease,
} from '../dist/index.js';
import { setFilesystemFaultInjectorForTests, setTransactionFaultInjectorForTests } from '../dist/testing.js';

const [authority, requestedEvent, requestedOccurrenceText = '1'] = process.argv.slice(2);
const requestedOccurrence = Number.parseInt(requestedOccurrenceText, 10);
if (authority === undefined || requestedEvent === undefined || !Number.isSafeInteger(requestedOccurrence))
  throw new Error('Crash worker requires authority, fault-event, and occurrence arguments.');

const encode = (value) => new TextEncoder().encode(value);
const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
const first = resolveManagedPath(root, 'records/first.txt');
const second = resolveManagedPath(root, 'records/second.txt');
const originalFirst = encode('original-first');
const originalSecond = encode('original-second');
await withRepositoryLease(root, (lease) =>
  applyCanonicalBatch(root, lease, [
    { kind: 'write', path: first, bytes: originalFirst, expected: 'absent' },
    { kind: 'write', path: second, bytes: originalSecond, expected: 'absent' },
  ]),
);

if (requestedEvent.startsWith('filesystem:')) {
  const filesystemEvent = requestedEvent.slice('filesystem:'.length);
  setFilesystemFaultInjectorForTests((event, _path, occurrence) => {
    if (event === filesystemEvent && occurrence === requestedOccurrence) process.kill(process.pid, 'SIGKILL');
  });
} else {
  setTransactionFaultInjectorForTests((event, occurrence) => {
    if (event === requestedEvent && occurrence === requestedOccurrence) process.kill(process.pid, 'SIGKILL');
  });
}
await withRepositoryLease(
  root,
  (lease) =>
    applyCanonicalBatch(root, lease, [
      {
        kind: 'write',
        path: first,
        bytes: encode('committed-first'),
        expected: computeByteRevision(originalFirst),
      },
      {
        kind: 'write',
        path: second,
        bytes: encode('committed-second'),
        expected: computeByteRevision(originalSecond),
      },
    ]),
  { staleMs: 1 },
);
