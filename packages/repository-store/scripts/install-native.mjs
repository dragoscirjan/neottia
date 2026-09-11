import { spawnSync } from 'node:child_process';

if (process.platform === 'linux') {
  const command = process.platform === 'win32' ? 'node-gyp.cmd' : 'node-gyp';
  const result = spawnSync(command, ['rebuild'], { stdio: 'inherit', shell: true });
  if (result.status !== 0)
    console.warn(
      '@neottia/repository-store: native exact-publication backend was not built; destructive filesystem mutations will fail with UNSUPPORTED_RUNTIME.',
    );
}
