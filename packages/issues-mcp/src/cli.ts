#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createIssueServer } from './server.js';

const server = createIssueServer();
await server.connect(new StdioServerTransport());
