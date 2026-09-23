import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { resolveConfig } from '@neottia/config';
import { officialConfigRegistry } from '@neottia/config-registry';
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

const SUPPORTED_INIT_HARNESSES = Object.freeze(['opencode', 'pi'] as const);
type SupportedInitHarness = (typeof SUPPORTED_INIT_HARNESSES)[number];

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
    if (command === 'apply') return await applyCommand(arguments_, output);
    if (command === 'init') return await initCommand(arguments_, output);
    if (command === 'recover') return await recoverCommand(arguments_, output);
    if (command === 'doctor') return await doctorCommand(arguments_, output, env);
    if (command === 'uninstall') return await uninstallCommand(arguments_, output, env);
    if (command === 'plan') return await planCommand(arguments_, output, env);
    throw new TypeError(`Unknown command: ${command}`);
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** Creates the first project-local configuration for selected harnesses. */
async function initCommand(arguments_: readonly string[], output: CliOutput): Promise<number> {
  const { values } = parseArgs({
    args: [...arguments_],
    strict: true,
    allowPositionals: false,
    options: {
      harness: { type: 'string', multiple: true, default: [] },
      project: { type: 'string' },
    },
  });
  const harnesses = normalizeInitHarnesses(values.harness);
  const project = resolve(values.project ?? process.cwd());
  const document = createInitDocument(harnesses);

  // Validate the exact root shape through the official registry without reading
  // ambient global or project configuration.
  resolveConfig(officialConfigRegistry, {
    cwd: project,
    env: {},
    globalFile: false,
    projectFile: false,
    overrides: document,
  });

  const configPath = join(project, '.neottia', 'config.yml');
  await publishNewConfig(configPath, renderInitConfig(harnesses));
  output.log(`Created ${configPath}`);
  output.log(`Harnesses: ${harnesses.join(', ')}`);
  output.log('Next: neottia plan --manifest <manifest.json> --output install.plan.json');
  return 0;
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

/** Validates, deduplicates, and orders initializer harness arguments. */
function normalizeInitHarnesses(values: readonly string[]): readonly SupportedInitHarness[] {
  if (values.length === 0) throw new TypeError('init requires at least one --harness.');
  const unsupported = values.find(
    (value): value is string => !SUPPORTED_INIT_HARNESSES.includes(value as SupportedInitHarness),
  );
  if (unsupported !== undefined) {
    throw new TypeError(
      `Unsupported init harness: ${unsupported}. Expected one of: ${SUPPORTED_INIT_HARNESSES.join(', ')}.`,
    );
  }
  return Object.freeze(
    [...new Set(values as readonly SupportedInitHarness[])].sort((left, right) => left.localeCompare(right)),
  );
}

/** Builds the minimal owned shards for the initializer. The file adds `version`. */
function createInitDocument(harnesses: readonly SupportedInitHarness[]): Readonly<Record<string, unknown>> {
  const assignments = Object.fromEntries(
    harnesses.map((harness) => [
      harness,
      {
        planner: { agent: 'current' },
        implementer: { agent: 'current' },
        verifier: { agent: 'current' },
        'release-coordinator': { agent: 'current' },
      },
    ]),
  );
  return Object.freeze({
    modules: {
      issues: { enabled: true },
      design_docs: { enabled: true },
    },
    capabilities: {
      issues: { provider: 'filesystem' },
      documents: { provider: 'filesystem' },
      source_control: { local: 'git', remote: false, workspaces: false },
    },
    harnesses: {
      install: { targets: harnesses.map((id) => ({ id, scope: 'project' })) },
    },
    agents: { sdlc: assignments },
  });
}

/** Renders stable human-editable YAML for the minimal configuration. */
function renderInitConfig(harnesses: readonly SupportedInitHarness[]): string {
  const targets = harnesses.flatMap((harness) => [`      - id: ${harness}`, '        scope: project']);
  const assignments = harnesses.flatMap((harness) => [
    `    ${harness}:`,
    '      planner: {agent: current}',
    '      implementer: {agent: current}',
    '      verifier: {agent: current}',
    '      release-coordinator: {agent: current}',
  ]);
  return [
    'version: 1',
    'modules:',
    '  issues:',
    '    enabled: true',
    '  design_docs:',
    '    enabled: true',
    'capabilities:',
    '  issues:',
    '    provider: filesystem',
    '  documents:',
    '    provider: filesystem',
    '  source_control:',
    '    local: git',
    '    remote: false',
    '    workspaces: false',
    'harnesses:',
    '  install:',
    '    targets:',
    ...targets,
    'agents:',
    '  sdlc:',
    ...assignments,
    '',
  ].join('\n');
}

/** Publishes a complete file without replacing an existing configuration. */
async function publishNewConfig(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  await ensureConfigDirectory(directory);
  const temporary = join(directory, `.config.yml.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, path);
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) throw new TypeError(`Configuration already exists: ${path}`);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch((error: unknown) => {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    });
  }
}

/** Creates or verifies the canonical configuration directory. */
async function ensureConfigDirectory(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError(`Configuration parent is not a regular directory: ${path}`);
    }
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError(`Configuration parent is not a regular directory: ${path}`);
    }
  }
}

/** Narrows Node filesystem errors without exposing rejected content. */
function hasErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
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
    '  neottia init --harness pi|opencode [--harness pi|opencode]... [--project DIR]',
    '  neottia plan --manifest FILE [--action install|update] [--output FILE] [--approve ID]...',
    '  neottia apply --plan FILE',
    '  neottia uninstall --receipt FILE [--output FILE] [--approve ID]...',
    '  neottia doctor --manifest FILE',
    '  neottia recover --receipt FILE',
  ].join('\n');
}
