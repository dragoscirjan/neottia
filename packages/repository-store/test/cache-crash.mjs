import {
  DEFAULT_STORE_LIMITS,
  rebuildDisposableSqliteCache,
  resolveManagedPath,
  resolveManagedRoot,
  withRepositoryLease,
} from '../dist/index.js';
import { setFilesystemFaultInjectorForTests } from '../dist/testing.js';

const [authority, requestedEvent] = process.argv.slice(2);
if (authority === undefined || requestedEvent === undefined)
  throw new Error('Cache crash worker requires an authority root and filesystem event.');

const root = await resolveManagedRoot({ authorityRoot: authority, limits: DEFAULT_STORE_LIMITS });
const path = resolveManagedPath(root, 'cache.db');
const specification = (digest) => ({
  path,
  applicationId: 0x4e454f54,
  schemaVersion: 1,
  canonicalDigest: digest,
  schemaSql: ['CREATE TABLE domain_records (id TEXT PRIMARY KEY, value TEXT NOT NULL);'],
  async populate(database) {
    const insert = await database.prepare('INSERT INTO domain_records (id, value) VALUES (?, ?)');
    await insert.run(['one', digest]);
  },
  async healthCheck(database) {
    const row = await (await database.prepare('SELECT value FROM domain_records WHERE id=?')).get(['one']);
    if (row?.value !== digest) throw new Error('Cache projection is contradictory.');
  },
});

await withRepositoryLease(root, async (lease) => {
  const cache = await rebuildDisposableSqliteCache(root, lease, specification('original'));
  await cache.close();
});

const activePath = `${authority}/cache.db`;
setFilesystemFaultInjectorForTests((event, target) => {
  if (event === requestedEvent && target === activePath) process.kill(process.pid, 'SIGKILL');
});
await withRepositoryLease(root, async (lease) => {
  await rebuildDisposableSqliteCache(root, lease, specification('replacement'));
});
