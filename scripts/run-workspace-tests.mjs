import { spawnSync } from 'node:child_process';

/** Runs a command with inherited output and preserves its exit status. */
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, shell: false, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} terminated with signal ${result.signal}.`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Build once before concurrent tests so package pretests do not race over dist.
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
run(pnpm, ['run', 'build']);
run(pnpm, ['-r', 'run', '--if-present', 'test'], {
  ...process.env,
  NEOTTIA_WORKSPACE_PREBUILT: '1',
});
