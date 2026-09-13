import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredOutputs = [
  '../config/dist/index.js',
  '../repository-store/dist/index.js',
  '../design-docs/dist/index.js',
  '../issues/dist/index.js',
  '../memory-core/dist/index.js',
  '../searchable-core/dist/index.js',
  '../config-registry/dist/index.js',
];

// Root validation builds every workspace first; direct package tests need the registry dependency closure on demand.
if (requiredOutputs.some((path) => !existsSync(resolve(packageRoot, path)))) {
  execFileSync('pnpm', ['--filter', '@neottia/config-registry...', 'run', 'build'], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
}
