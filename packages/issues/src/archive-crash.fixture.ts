import { issueConfigSchema } from './config.js';
import { IssueStore } from './store.js';
import { setTransactionFaultInjectorForTests } from '../../repository-store/dist/internal/fault-injection.js';

const [cwd, id, revision, event] = process.argv.slice(2);
if (!cwd || !id || !revision || !event) process.exit(2);
setTransactionFaultInjectorForTests((observed) => {
  if (observed === event) process.exit(86);
});
const store = new IssueStore(issueConfigSchema.parse({ enabled: true }), cwd);
await store.archive(id, revision);
process.exit(0);
