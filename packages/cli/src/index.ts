import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { resolveConfig, type ResolvedConfigSnapshot } from '@neottia/config';
import { harnessInstallConfigContribution, officialConfigRegistry } from '@neottia/config-registry';
import { designDocsConfigContribution } from '@neottia/design-docs';
import {
  applyInstallationPlan,
  authorizePlan,
  canonicalJson,
  createInstallationPlan,
  decodeInstallationPlan,
  diagnoseSnapshot,
  inspectInstallation,
  inspectUninstall,
  receiptPath as distributionReceiptPath,
  recoverInstallation,
  runDoctor,
  validateManifest,
  type AssetManifest,
  type InstallRoots,
  type InstallationPlan,
} from '@neottia/distribution';
import type { NeottiaRuntimePackageId } from '@neottia/harness-adapter';
import { issueConfigContribution } from '@neottia/issues';
import { memoryConfigContribution } from '@neottia/memory-core';
import { opencodeHarnessAdapter } from '@neottia/opencode-adapter';
import { piHarnessAdapter } from '@neottia/pi-adapter';
import { compileSdlc, createSdlcCompilerInput, loadSdlcTemplateLayers, type SdlcRuntimePackage } from '@neottia/sdlc';
import { searchableConfigContribution } from '@neottia/searchable-core';

import { catalogEntry } from './catalog.js';

const SUPPORTED_HARNESSES = Object.freeze(['opencode', 'pi'] as const);
type SupportedHarness = (typeof SUPPORTED_HARNESSES)[number];

/** First-party adapters addressable by the config-driven commands. */
const HARNESS_ADAPTERS: Readonly<Record<SupportedHarness, typeof piHarnessAdapter | typeof opencodeHarnessAdapter>> =
  Object.freeze({ pi: piHarnessAdapter, opencode: opencodeHarnessAdapter });

/** Warn prefix used for every skipped conflict and diagnostic line. */
const WARN_PREFIX = 'WARN: ';

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
    if (command === 'apply') return await applyCommand(arguments_, output, env);
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

/** Creates or validates the project-local configuration for selected harnesses. */
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
  const project = resolve(values.project ?? process.cwd());
  const configPath = join(project, '.neottia', 'config.yml');
  if (values.harness.length === 0 && (await isRegularFile(configPath))) {
    // Existing configuration: validate it instead of creating or touching it.
    resolveConfig(officialConfigRegistry, { cwd: project, env: {} });
    output.log(`Validated ${configPath}`);
    output.log('Next: neottia apply');
    return 0;
  }
  const harnesses = normalizeInitHarnesses(values.harness);
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

  await publishNewConfig(configPath, renderInitConfig(harnesses));
  output.log(`Created ${configPath}`);
  output.log(`Harnesses: ${harnesses.join(', ')}`);
  output.log('Next: neottia apply');
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

/** Applies a serialized plan, or compiles and installs the configured lifecycle. */
async function applyCommand(arguments_: readonly string[], output: CliOutput, env: NodeJS.ProcessEnv): Promise<number> {
  const { values } = parseArgs({
    args: [...arguments_],
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'string' },
      harness: { type: 'string', multiple: true, default: [] },
      scope: { type: 'string' },
      project: { type: 'string' },
    },
  });
  if (values.plan !== undefined) {
    const plan = decodeInstallationPlan(JSON.parse(await readFile(values.plan, 'utf8')));
    const result = await applyInstallationPlan(plan);
    output.log(canonicalJson(result));
    return 0;
  }
  const project = resolve(values.project ?? process.cwd());
  if (!(await isRegularFile(join(project, '.neottia', 'config.yml')))) {
    throw new TypeError('Run neottia init first. Missing project configuration.');
  }
  const harnesses = selectHarnesses(values.harness, project, env);
  const scope = parseScope(values.scope);
  let skipped = 0;
  for (const harnessId of harnesses) {
    skipped += await installHarness(harnessId, { project, env, scope }, output);
  }
  if (skipped > 0) {
    output.error(`${skipped} file(s) skipped. Resolve the warnings above, then run neottia apply again.`);
    return 2;
  }
  output.log('Done. Reload the harness so generated assets are picked up.');
  return 0;
}

/** Compiles and installs the lifecycle for one harness, returning skipped conflict count. */
async function installHarness(
  harnessId: SupportedHarness,
  context: { readonly project: string; readonly env: NodeJS.ProcessEnv; readonly scope: 'project' | 'global' },
  output: CliOutput,
): Promise<number> {
  const adapter = HARNESS_ADAPTERS[harnessId];
  const snapshot = resolveConfig(officialConfigRegistry, { cwd: context.project, env: context.env });
  const templateLayers = await loadSdlcTemplateLayers({ projectRoot: context.project });
  const runtimePackages = selectedRuntimePackages(harnessId, snapshot);
  const input = createSdlcCompilerInput(snapshot, {
    compilerVersion: CLI_VERSION,
    harnessId,
    harnessDeclaration: adapter.declaration,
    scope: context.scope,
    templateLayers,
    runtimePackages,
  });
  const compiled = compileSdlc(input, adapter);
  const installRoots = installRootsFor(context.project, context.env);
  const inspected = await inspectInstallation(compiled.assets, installRoots);
  const action = inspected.receipt === undefined ? 'install' : 'update';
  const plan = createInstallationPlan(inspected, action);
  const conflicts = plan.conflicts.filter((conflict) => !conflict.approved);
  for (const conflict of conflicts) {
    output.error(
      `${WARN_PREFIX}skipped ${conflict.path} (${conflict.reason}). Resolve or remove the file, then rerun neottia apply.`,
    );
  }
  // Re-plan without the conflicted units so skipped files are neither written
  // nor claimed by the receipt; the remaining files still install.
  const conflictedAssets = new Set(conflicts.map((conflict) => conflict.assetId));
  const filtered = {
    ...inspected,
    units: inspected.units.filter((unit) => !conflictedAssets.has(unit.assetId)),
  };
  const partial = createInstallationPlan(filtered, action);
  const result = await applyInstallationPlan(authorizePlan(partial, []));
  output.log(
    `Installed ${harnessId} ${context.scope} lifecycle (${result.appliedMutations.length} mutation(s), ${conflicts.length} skipped).`,
  );
  if (result.reloadNotice !== undefined) output.log(result.reloadNotice.message);
  return conflicts.length;
}

/** Version of this CLI, used as the compiler version for config-driven installs. */
const CLI_VERSION = '0.3.0';

/** Resolves the harness list: explicit arguments, else every configured target. */
function selectHarnesses(
  requested: readonly string[],
  project: string,
  env: NodeJS.ProcessEnv,
): readonly SupportedHarness[] {
  if (requested.length > 0) return normalizeInitHarnesses(requested);
  const configured = resolveConfig(officialConfigRegistry, { cwd: project, env })
    .get(harnessInstallConfigContribution)
    .targets.map((target) => target.id);
  const unsupported = configured.find((id) => !SUPPORTED_HARNESSES.includes(id as SupportedHarness));
  if (unsupported !== undefined) throw new TypeError(`Unsupported configured harness: ${unsupported}.`);
  if (configured.length === 0) throw new TypeError('No configured harnesses. Add harnesses.install.targets first.');
  return Object.freeze([...new Set(configured as SupportedHarness[])].sort((left, right) => left.localeCompare(right)));
}

/** Resolves exact runtime package versions for the enabled modules of one harness. */
function selectedRuntimePackages(
  harnessId: SupportedHarness,
  snapshot: ResolvedConfigSnapshot,
): readonly SdlcRuntimePackage[] {
  const packages: SdlcRuntimePackage[] = [];
  const candidates: ReadonlyArray<readonly [NeottiaRuntimePackageId, boolean]> = [
    ['memory', snapshot.get(memoryConfigContribution).enabled],
    ['issues', snapshot.get(issueConfigContribution).enabled],
    ['design-docs', snapshot.get(designDocsConfigContribution).enabled],
    ['searchable', snapshot.get(searchableConfigContribution).enabled],
  ];
  for (const [logicalId, enabled] of candidates) {
    if (!enabled) continue;
    const entry = catalogEntry(harnessId, logicalId);
    if (entry === undefined) {
      throw new TypeError(`No compatible runtime package for ${harnessId} ${logicalId}.`);
    }
    packages.push({ logicalId, version: entry.version });
  }
  return Object.freeze(packages);
}

/** Maps the shared scope argument onto the compiler and installer vocabulary. */
function parseScope(value: string | undefined): 'project' | 'global' {
  if (value === undefined) return 'project';
  if (value === 'project' || value === 'global') return value;
  throw new TypeError('apply --scope must be project or global.');
}

/** Builds distribution install roots from project and environment. */
function installRootsFor(project: string, env: NodeJS.ProcessEnv): InstallRoots {
  const home = resolve(env.HOME ?? homedir());
  return {
    project,
    home,
    xdgConfig: resolve(env.XDG_CONFIG_HOME ?? `${home}/.config`),
    xdgState: resolve(env.XDG_STATE_HOME ?? `${home}/.local/state`),
  };
}

/** Reports whether one path is a regular file. */
async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

/** Reports static configuration and installation health without changing either. */
async function doctorCommand(
  arguments_: readonly string[],
  output: CliOutput,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const values = parseCommon(arguments_);
  const project = resolve(values.project ?? process.cwd());
  if (values.manifest !== undefined) {
    // Advanced release-pipeline flow: full prerequisites plus receipt drift.
    const manifest = await readManifest(values.manifest);
    const rootValues = roots(values, env);
    const snapshot = await inspectInstallation(manifest, rootValues);
    const results = [...(await runDoctor(manifest, rootValues, env)), ...diagnoseSnapshot(snapshot)];
    output.log(canonicalJson(results));
    return results.some((result) => result.status === 'error') ? 2 : 0;
  }
  // Config-driven flow: validate configuration and report module and install gaps.
  if (!(await isRegularFile(join(project, '.neottia', 'config.yml')))) {
    output.error(`${WARN_PREFIX}Missing project configuration. Run neottia init first.`);
    return 2;
  }
  const snapshot = resolveConfig(officialConfigRegistry, { cwd: project, env });
  const modules: ReadonlyArray<readonly [NeottiaRuntimePackageId, string, boolean]> = [
    ['memory', 'modules.memory.enabled', snapshot.get(memoryConfigContribution).enabled],
    ['issues', 'modules.issues.enabled', snapshot.get(issueConfigContribution).enabled],
    ['design-docs', 'modules.design_docs.enabled', snapshot.get(designDocsConfigContribution).enabled],
    ['searchable', 'modules.searchable.enabled', snapshot.get(searchableConfigContribution).enabled],
  ];
  const harnesses = selectHarnesses([], project, env);
  let failures = 0;
  output.log(`Configuration valid. Harnesses: ${harnesses.join(', ')}`);
  for (const harnessId of harnesses) {
    for (const [logicalId, configPath, enabled] of modules) {
      if (!enabled) continue;
      void configPath;
      const entry = catalogEntry(harnessId, logicalId);
      if (entry === undefined) {
        output.error(
          `${WARN_PREFIX}No compatible runtime package for ${harnessId} ${logicalId}. Remove the module or extend the catalog.`,
        );
        failures += 1;
      }
    }
  }
  for (const harnessId of harnesses) {
    const receiptPath = receiptPathFor(harnessId, 'project', installRootsFor(project, env));
    if (await isRegularFile(receiptPath)) continue;
    output.error(`${WARN_PREFIX}${harnessId} lifecycle is not installed. Run neottia apply.`);
    failures += 1;
  }
  if (failures === 0) output.log('No missing modules or installs detected.');
  return failures > 0 ? 2 : 0;
}

/** Computes one harness receipt path without reading it. */
function receiptPathFor(harnessId: string, scope: 'project' | 'global', installRoots: InstallRoots): string {
  return distributionReceiptPath(`sdlc-${harnessId}`, scope, installRoots);
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

/** Validates, deduplicates, and orders harness arguments. */
function normalizeInitHarnesses(values: readonly string[]): readonly SupportedHarness[] {
  if (values.length === 0) throw new TypeError('At least one --harness is required.');
  const unsupported = values.find((value): value is string => !SUPPORTED_HARNESSES.includes(value as SupportedHarness));
  if (unsupported !== undefined) {
    throw new TypeError(`Unsupported harness: ${unsupported}. Expected one of: ${SUPPORTED_HARNESSES.join(', ')}.`);
  }
  return Object.freeze(
    [...new Set(values as readonly SupportedHarness[])].sort((left, right) => left.localeCompare(right)),
  );
}

/** Builds the minimal owned shards for the initializer. The file adds `version`. */
function createInitDocument(harnesses: readonly SupportedHarness[]): Readonly<Record<string, unknown>> {
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
function renderInitConfig(harnesses: readonly SupportedHarness[]): string {
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

/** Returns concise usage for the primary and advanced workflows. */
function help(): string {
  return [
    'Usage:',
    '  neottia init [--harness pi|opencode]... [--project DIR]   # create, or validate if present',
    '  neottia apply [--harness ID]... [--scope project|global] [--project DIR]',
    '  neottia doctor [--project DIR]                            # static config + install report',
    '  neottia plan --manifest FILE [--action install|update] [--output FILE] [--approve ID]...',
    '  neottia apply --plan FILE',
    '  neottia uninstall --receipt FILE [--output FILE] [--approve ID]...',
    '  neottia doctor --manifest FILE',
    '  neottia recover --receipt FILE',
  ].join('\n');
}
