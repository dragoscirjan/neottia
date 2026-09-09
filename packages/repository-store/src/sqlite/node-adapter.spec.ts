import { describe, expect, it } from 'vitest';
import { nodeSqliteAdapter } from './node.js';
import { runSqliteAdapterContract } from './test-contract.js';

runSqliteAdapterContract({ describe, expect, it }, nodeSqliteAdapter);
