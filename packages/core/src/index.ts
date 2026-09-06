#!/usr/bin/env node

/**
 * Main entry point for the Neottia core package.
 * Demonstrates ESM module usage and clean TypeScript practices.
 *
 * @module
 */

import { Greeter, hello } from './lib/greeter.js';

/**
 * Main function that demonstrates the template functionality.
 * Logs a greeting message to the console.
 * @returns {void}
 */
function main(): void {
  const message = hello('World');
  console.log(message);
}

export { Greeter, hello, main };
