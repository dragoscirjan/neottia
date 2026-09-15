#!/usr/bin/env node

import { main } from './index.js';

/** Preserve the numeric command result for shells and automation. */
process.exitCode = await main();
