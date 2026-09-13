#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSearchableServer } from './server.js';

const server = createSearchableServer();
let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await server.close();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
await server.connect(new StdioServerTransport());
