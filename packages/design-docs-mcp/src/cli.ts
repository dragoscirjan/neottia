#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDesignDocsServer } from './server.js';

/** Starts the generic non-interactive stdio transport. */
const server = createDesignDocsServer();
await server.connect(new StdioServerTransport());
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
