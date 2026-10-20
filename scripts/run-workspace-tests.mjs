import { spawnSync } from 'node:child_process';

/** Runs a command with inherited output and preserves its exit status. */
function run(command, args, env = process.env) {
  // Windows requires a shell to execute pnpm's .cmd shim. All arguments below are constants.
  const result = spawnSync(command, args, {
    env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} terminated with signal ${result.signal}.`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Build once before concurrent tests so package pretests do not race over dist.
const pnpm = 'pnpm';
run(pnpm, ['run', 'build']);
run(pnpm, ['-r', 'run', '--if-present', 'test'], {
  ...process.env,
  NEOTTIA_WORKSPACE_PREBUILT: '1',
});
