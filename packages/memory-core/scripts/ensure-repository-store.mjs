import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repositoryStore = fileURLToPath(new URL('../../repository-store/', import.meta.url));
const ready =
  existsSync(`${repositoryStore}/dist/testing.js`) &&
  existsSync(`${repositoryStore}/build/Release/repository_store_native.node`);

// Focused Memory tests may start from a clean checkout, while the root
// validation task has already built this dependency and must not race-rebuild it.
if (!ready) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const build = spawnSync(command, ['--filter', '@neottia/repository-store', 'build'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    stdio: 'inherit',
  });
  if (build.error !== undefined) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
}
