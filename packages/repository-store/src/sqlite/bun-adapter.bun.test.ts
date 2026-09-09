import { describe, expect, it } from 'bun:test';
import { bunSqliteAdapter } from './bun.js';
import { runSqliteAdapterContract } from './test-contract.js';

runSqliteAdapterContract({ describe, expect, it }, bunSqliteAdapter);
