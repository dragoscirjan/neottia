import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIntegrityReceipt } from './native-prebuild.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function buildNativeFromSource({ root = packageRoot, stdio = 'inherit' } = {}) {
  const require = createRequire(import.meta.url);
  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
  const result = spawnSync(process.execPath, [nodeGyp, 'rebuild'], {
    cwd: root,
    stdio,
    shell: false,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`node-gyp rebuild exited with status ${String(result.status)}.`);
  return writeIntegrityReceipt(root, 'source-build');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    buildNativeFromSource();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
