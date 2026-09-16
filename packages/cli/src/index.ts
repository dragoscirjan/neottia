import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  applyInstallationPlan,
  authorizePlan,
  canonicalJson,
  createInstallationPlan,
  decodeInstallationPlan,
  diagnoseSnapshot,
  inspectInstallation,
  inspectUninstall,
  recoverInstallation,
  runDoctor,
  validateManifest,
  type AssetManifest,
  type InstallRoots,
  type InstallationPlan,
} from '@neottia/distribution';

/** Injectable output used by tests and embedding callers. */
export interface CliOutput {
  log(message: string): void;
  error(message: string): void;
}

/** Runs one Neottia CLI command and returns its process exit code. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  output: CliOutput = console,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    const [command, ...arguments_] = argv;
    if (command === undefined || command === 'help' || command === '--help') {
      output.log(help());
      return 0;
    }
    if (command === 'apply') return applyCommand(arguments_, output);
    if (command === 'recover') return recoverCommand(arguments_, output);
    if (command === 'doctor') return doctorCommand(arguments_, output, env);
    if (command === 'uninstall') return uninstallCommand(arguments_, output, env);
    if (command === 'plan') return planCommand(arguments_, output, env);
    throw new TypeError(`Unknown command: ${command}`);
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** Generates and optionally saves an install or update plan. */
async function planCommand(arguments_: readonly string[], output: CliOutput, env: NodeJS.ProcessEnv): Promise<number> {
  const values = parseCommon(arguments_);
  if (values.manifest === undefined) throw new TypeError('plan requires --manifest.');
  if (values.action !== 'install' && values.action !== 'update')
    throw new TypeError('plan --action must be install or update.');
  const manifest = await readManifest(values.manifest);
  const snapshot = await inspectInstallation(manifest, roots(values, env));
  const plan = authorizePlan(createInstallationPlan(snapshot, values.action), values.approve);
  await emitPlan(plan, values.output, output);
  return plan.conflicts.some((conflict) => !conflict.approved) ? 2 : 0;
}

/** Generates and optionally saves a receipt-driven uninstall plan. */
async function uninstallCommand(
  arguments_: readonly string[],
  output: CliOutput,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const values = parseCommon(arguments_);
  if (values.receipt === undefined) throw new TypeError('uninstall requires --receipt.');
  const snapshot = await inspectUninstall(resolve(values.receipt), roots(values, env));
  const plan = authorizePlan(createInstallationPlan(snapshot, 'uninstall'), values.approve);
  await emitPlan(plan, values.output, output);
  return plan.conflicts.some((conflict) => !conflict.approved) ? 2 : 0;
}

/** Applies only a previously serialized and authorized plan. */
async function applyCommand(arguments_: readonly string[], output: CliOutput): Promise<number> {
  const { values } = parseArgs({
    args: [...arguments_],
    strict: true,
    allowPositionals: false,
    options: { plan: { type: 'string' } },
  });
  if (values.plan === undefined) throw new TypeError('apply requires --plan.');
  const plan = decodeInstallationPlan(JSON.parse(await readFile(values.plan, 'utf8')));
  const result = await applyInstallationPlan(plan);
  output.log(canonicalJson(result));
  return 0;
}

/** Reports prerequisites plus receipt drift without changing either. */
async function doctorCommand(
  arguments_: readonly string[],
  output: CliOutput,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const values = parseCommon(arguments_);
  if (values.manifest === undefined) throw new TypeError('doctor requires --manifest.');
  const manifest = await readManifest(values.manifest);
  const rootValues = roots(values, env);
  const snapshot = await inspectInstallation(manifest, rootValues);
  const results = [...(await runDoctor(manifest, rootValues, env)), ...diagnoseSnapshot(snapshot)];
  output.log(canonicalJson(results));
  return results.some((result) => result.status === 'error') ? 2 : 0;
}

/** Recovers an interrupted transaction using its durable journal. */
async function recoverCommand(arguments_: readonly string[], output: CliOutput): Promise<number> {
  const { values } = parseArgs({
    args: [...arguments_],
    strict: true,
    allowPositionals: false,
    options: { receipt: { type: 'string' } },
  });
  if (values.receipt === undefined) throw new TypeError('recover requires --receipt.');
  output.log(canonicalJson({ status: await recoverInstallation(resolve(values.receipt)) }));
  return 0;
}

/** Parsed options shared by plan, uninstall, and doctor. */
interface CommonValues {
  readonly manifest?: string;
  readonly receipt?: string;
  readonly output?: string;
  readonly action: string;
  readonly approve: readonly string[];
  readonly project?: string;
  readonly home?: string;
  readonly 'xdg-config'?: string;
  readonly 'xdg-state'?: string;
}

/** Parses root and planning options without command-specific ambiguity. */
function parseCommon(arguments_: readonly string[]): CommonValues {
  const { values } = parseArgs({
    args: [...arguments_],
    strict: true,
    allowPositionals: false,
    options: {
      manifest: { type: 'string' },
      receipt: { type: 'string' },
      output: { type: 'string' },
      action: { type: 'string', default: 'install' },
      approve: { type: 'string', multiple: true, default: [] },
      project: { type: 'string' },
      home: { type: 'string' },
      'xdg-config': { type: 'string' },
      'xdg-state': { type: 'string' },
    },
  });
  return values;
}

/** Resolves ambient defaults in the CLI, never inside an adapter. */
function roots(values: CommonValues, env: NodeJS.ProcessEnv): InstallRoots {
  const home = resolve(typeof values.home === 'string' ? values.home : (env.HOME ?? homedir()));
  return {
    project: resolve(typeof values.project === 'string' ? values.project : process.cwd()),
    home,
    xdgConfig: resolve(
      typeof values['xdg-config'] === 'string' ? values['xdg-config'] : (env.XDG_CONFIG_HOME ?? `${home}/.config`),
    ),
    xdgState: resolve(
      typeof values['xdg-state'] === 'string' ? values['xdg-state'] : (env.XDG_STATE_HOME ?? `${home}/.local/state`),
    ),
  };
}

/** Reads and verifies one compiler-produced manifest. */
async function readManifest(path: string): Promise<AssetManifest> {
  const manifest = JSON.parse(await readFile(path, 'utf8')) as AssetManifest;
  validateManifest(manifest);
  return manifest;
}

/** Prints every operation and saves the same bytes when requested. */
async function emitPlan(plan: InstallationPlan, path: string | undefined, output: CliOutput): Promise<void> {
  const content = canonicalJson(plan);
  output.log(content);
  if (path !== undefined) await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
}

/** Returns concise usage with the explicit review/apply split. */
function help(): string {
  return [
    'Usage:',
    '  neottia plan --manifest FILE [--action install|update] [--output FILE] [--approve ID]...',
    '  neottia apply --plan FILE',
    '  neottia uninstall --receipt FILE [--output FILE] [--approve ID]...',
    '  neottia doctor --manifest FILE',
    '  neottia recover --receipt FILE',
  ].join('\n');
}
