import { spawnSync } from 'node:child_process';

// Direct package tests build their dependency closure; root tests already did.
if (process.env['NEOTTIA_WORKSPACE_PREBUILT'] !== '1') {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('A command is required.');
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command;
  const result = spawnSync(executable, args, { shell: false, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${executable} terminated with signal ${result.signal}.`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
