import { spawnSync } from 'node:child_process';

if (process.platform === 'linux' || process.platform === 'darwin' || process.platform === 'win32') {
  const command = process.platform === 'win32' ? 'node-gyp.cmd' : 'node-gyp';
  const result = spawnSync(command, ['rebuild'], { stdio: 'inherit', shell: true });
  if (result.status !== 0)
    console.warn(
      '@neottia/repository-store: native platform backend was not built; destructive filesystem mutations will fail with UNSUPPORTED_RUNTIME.',
    );
}
