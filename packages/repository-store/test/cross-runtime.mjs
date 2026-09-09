import { existsSync } from 'node:fs';
import {
  DEFAULT_STORE_LIMITS,
  applyCanonicalBatch,
  openDisposableSqliteCache,
  rebuildDisposableSqliteCache,
  resolveManagedPath,
  resolveManagedRoot,
  withRepositoryLease,
} from '../dist/index.js';
import { setTransactionFaultInjectorForTests } from '../dist/internal/fault-injection.js';

const [mode, authority] = process.argv.slice(2);
if (!['rebuild', 'verify', 'crash-transaction', 'recover-transaction'].includes(mode) || authority === undefined)
  throw new Error('Usage: cross-runtime.mjs <rebuild|verify|crash-transaction|recover-transaction> <authority>');

const root = await resolveManagedRoot({
  authorityRoot: authority,
  managedPath: 'domain',
  limits: DEFAULT_STORE_LIMITS,
});

if (mode === 'crash-transaction') {
  setTransactionFaultInjectorForTests((event) => {
    if (event === 'canonical-path-published') process.kill(process.pid, 'SIGKILL');
  });
  await withRepositoryLease(
    root,
    async (lease) =>
      applyCanonicalBatch(root, lease, [
        {
          kind: 'write',
          path: resolveManagedPath(root, 'records/crash.txt'),
          bytes: new TextEncoder().encode('partial'),
          expected: 'absent',
        },
      ]),
    { staleMs: 1 },
  );
} else if (mode === 'recover-transaction') {
  await withRepositoryLease(root, async () => undefined, { staleMs: 1 });
  if (existsSync(`${root.managedRoot}/records/crash.txt`))
    throw new Error('Cross-runtime rollback left partial bytes.');
} else {
  const specification = {
    path: resolveManagedPath(root, 'cache.db'),
    applicationId: 0x4e454f54,
    schemaVersion: 1,
    canonicalDigest: 'cross-runtime-digest',
    schemaSql: ['CREATE TABLE domain_records (id TEXT PRIMARY KEY, value TEXT NOT NULL);'],
    async populate(database) {
      const insert = await database.prepare('INSERT INTO domain_records (id, value) VALUES (?, ?)');
      await insert.run(['one', 'portable']);
    },
    async healthCheck(database) {
      const row = await (await database.prepare('SELECT value FROM domain_records WHERE id=?')).get(['one']);
      if (row?.value !== 'portable') throw new Error('Cross-runtime cache row is contradictory.');
    },
  };

  await withRepositoryLease(root, async (lease) => {
    if (mode === 'rebuild') {
      const rebuilt = await rebuildDisposableSqliteCache(root, lease, specification);
      await rebuilt.close();
      return;
    }
    const opened = await openDisposableSqliteCache(root, lease, specification);
    if (opened.state !== 'ready') throw new Error(`Cross-runtime cache was not ready: ${opened.reason}`);
    const row = await (await opened.database.prepare('SELECT value FROM domain_records WHERE id=?')).get(['one']);
    if (row?.value !== 'portable') throw new Error('Cross-runtime query returned unexpected data.');
    await opened.close();
  });
}
