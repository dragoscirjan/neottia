#!/usr/bin/env node

/**
 * Entry point for the memory MCP stdio server.
 * Configure through NEOTTIA_* env vars or .neottia/config.yml in the
 * working directory of the harness that spawns it.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMemoryServer } from './server.js';

const server = createMemoryServer();
await server.connect(new StdioServerTransport());
