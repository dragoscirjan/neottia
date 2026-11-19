#!/usr/bin/env bun

import {
  EXIT,
  InitError,
  Workspace,
  emit,
  ensureTomlArrayItem,
  ensureTomlTableKey,
  ensureTomlTask,
  handleError,
  mergeExactMap,
  parseArgs,
  projectName,
  readJsonObject,
  requireBun,
  resolveRoot,
  runCommand,
  validateRelativePath,
  validateVersion,
  writeJsonObject,
  type TomlTaskDefinition,
} from "../lib.ts";

interface GdscriptOptions {
  godot: string;
  python: string;
  uv: string;
  gdtoolkit: string;
  source: string;
}

const CHECK_GDSCRIPT = `#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const root = realpathSync(process.cwd());
const source = process.argv[2];
if (!source || isAbsolute(source)) {
  console.error('Usage: node scripts/check-gdscript.mjs PROJECT_RELATIVE_SOURCE');
  process.exit(2);
}
const sourceRoot = resolve(root, source);
const sourceRelative = relative(root, sourceRoot);
if (sourceRelative === '..' || sourceRelative.startsWith(\`..\${sep}\`)) {
  console.error('Source path escapes the project root');
  process.exit(2);
}
if (!existsSync(sourceRoot) || lstatSync(sourceRoot).isSymbolicLink()) {
  console.error('Source path must be an existing directory, not a symlink');
  process.exit(3);
}
const sourceReal = realpathSync(sourceRoot);
const realRelative = relative(root, sourceReal);
if (realRelative === '..' || realRelative.startsWith(\`..\${sep}\`)) {
  console.error('Source path resolves outside the project root');
  process.exit(3);
}

const skippedDirectories = new Set(['.git', '.godot', '.venv', 'addons', 'build', 'coverage', 'dist', 'node_modules']);

function collect(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skippedDirectories.has(entry.name)) continue;
    const target = join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(target).isSymbolicLink()) {
      console.error(\`Refusing to follow symlink: \${relative(root, target)}\`);
      process.exit(3);
    }
    if (entry.isDirectory()) files.push(...collect(target));
    else if (entry.isFile() && entry.name.endsWith('.gd')) files.push(target);
  }
  return files;
}

const files = collect(sourceReal).sort();
if (files.length === 0) {
  console.error(\`No GDScript files found under \${source}\`);
  process.exit(4);
}
const env = { ...process.env };
if (String(env.SSL_CERT_FILE).toLowerCase() === 'false') delete env.SSL_CERT_FILE;
for (const file of files) {
  const resourcePath = \`res://\${relative(root, file).split(sep).join('/')}\`;
  const result = spawnSync('godot', ['--headless', '--path', root, '--check-only', '--script', resourcePath], {
    env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error || result.status !== 0) {
    console.error(\`Godot failed to parse \${resourcePath}\`);
    process.exit(result.status || 5);
  }
}
console.log(\`Checked \${files.length} GDScript file(s)\`);
`;

const HELP = `Usage:
  bun scripts/gdscript/init.ts --root PATH --godot VERSION --python VERSION --uv VERSION [options]
  bun scripts/gdscript/init.ts --root PATH --godot VERSION --python VERSION --uv VERSION --apply --confirm [--install]

Adds pinned Godot, Python, uv, gdtoolkit, package scripts, and mise tasks to an
existing init-project foundation. The default mode is a dry-run plan.

Options:
  --root PATH          Existing initialized Godot project root (required)
  --godot VERSION      Exact Godot release, such as 4.7.2-stable (required)
  --python VERSION     Exact Python version used by gdtoolkit (required)
  --uv VERSION         Exact uv version (required)
  --gdtoolkit VERSION  Exact gdtoolkit version (default: 4.5.0)
  --source PATH        First-party GDScript root (default: .); skips Git, Godot,
                       dependency, addon, coverage, and build directories
  --dry-run            Explicitly select plan-only mode
  --apply              Write the planned files
  --confirm            Confirm that the complete GDScript plan was approved
  --install            Run mise, uv lock, and uv sync after writing files
  --format FORMAT      Output format: json or text (default: json)
  --help               Show this help

Exit codes:
  0 success                  2 invalid arguments
  3 configuration conflict   4 missing environment prerequisite
  5 external command failed  6 filesystem or unexpected failure

Example:
  bun scripts/gdscript/init.ts --root /work/game --godot 4.7.2-stable --python 3.13.13 --uv 0.11.25
  bun scripts/gdscript/init.ts --root /work/game --godot 4.7.2-stable --python 3.13.13 --uv 0.11.25 --apply --confirm --install`;

function pythonRequirement(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) throw new InitError("--python must include at least major.minor", EXIT.USAGE);
  return `>=${match[1]}.${match[2]}`;
}

function configurePyproject(
  workspace: Workspace,
  options: GdscriptOptions,
  root: string,
): void {
  let pyproject = workspace.read("pyproject.toml");
  const dependency = `gdtoolkit==${options.gdtoolkit}`;
  if (pyproject === null) {
    pyproject = `[project]\nname = ${JSON.stringify(`${projectName(root)}-gdscript-tooling`)}\nversion = "0.0.0"\nrequires-python = ${JSON.stringify(pythonRequirement(options.python))}\ndependencies = []\n`;
  }
  pyproject = ensureTomlArrayItem(pyproject, "dependency-groups", "dev", dependency);
  workspace.stage("pyproject.toml", pyproject);
}

function gdscriptScripts(source: string): Record<string, string> {
  return {
    "lint:gdscript": `uv run gdlint ${source}`,
    "format:gdscript": `uv run gdformat --check ${source}`,
    "format:fix:gdscript": `uv run gdformat ${source}`,
    "typecheck:gdscript": `node scripts/check-gdscript.mjs ${source}`,
  };
}

function configurePackage(workspace: Workspace, source: string): void {
  if (workspace.read("package.json") === null) {
    throw new InitError("package.json is missing; run init-project first", EXIT.ENVIRONMENT);
  }
  const manifest = readJsonObject(workspace, "package.json");
  if (!String(manifest.packageManager ?? "").startsWith("pnpm@")) {
    throw new InitError("package.json must declare the pnpm package manager from init-project", EXIT.CONFLICT);
  }
  mergeExactMap(manifest, "scripts", gdscriptScripts(source), "package.json");
  writeJsonObject(workspace, "package.json", manifest);
}

function configureMise(workspace: Workspace, options: GdscriptOptions): void {
  let mise = workspace.read("mise.toml");
  if (mise === null) {
    throw new InitError("mise.toml is missing; run init-project first", EXIT.ENVIRONMENT);
  }
  mise = ensureTomlTableKey(mise, "tools", "godot", JSON.stringify(options.godot));
  mise = ensureTomlTableKey(mise, "tools", "python", JSON.stringify(options.python));
  mise = ensureTomlTableKey(mise, "tools", "uv", JSON.stringify(options.uv));

  const tasks: readonly (readonly [string, TomlTaskDefinition])[] = [
    ["deps:sync:gdscript", { description: "Install locked GDScript tooling dependencies", run: "uv sync --locked" }],
    ["deps:sync", { depends: ["deps:sync:gdscript"] }],
    ["lint:check:gdscript", { description: "Lint first-party GDScript", run: "pnpm run lint:gdscript" }],
    ["lint", { depends: ["lint:check:gdscript"] }],
    ["format:check:gdscript", { description: "Check first-party GDScript formatting", run: "pnpm run format:gdscript" }],
    ["format:fix:gdscript", { description: "Write first-party GDScript formatting changes", run: "pnpm run format:fix:gdscript" }],
    ["format", { depends: ["format:check:gdscript"] }],
    ["format:fix", { depends: ["format:fix:gdscript"] }],
    ["typecheck:gdscript", { description: "Load and parse the Godot project headlessly", run: "pnpm run typecheck:gdscript" }],
    ["typecheck", { description: "Run configured static and parser checks", depends: ["typecheck:gdscript"] }],
    ["quality", { depends: ["typecheck"] }],
  ];
  for (const [name, definition] of tasks) mise = ensureTomlTask(mise, name, definition);
  workspace.stage("mise.toml", mise);
}

async function main(): Promise<void> {
  requireBun();
  const options = parseArgs(process.argv.slice(2), {
    root: { type: "string", required: true },
    godot: { type: "string", required: true },
    python: { type: "string", required: true },
    uv: { type: "string", required: true },
    gdtoolkit: { type: "string", default: "4.5.0" },
    source: { type: "string", default: "." },
    "dry-run": { type: "boolean" },
    apply: { type: "boolean" },
    confirm: { type: "boolean" },
    install: { type: "boolean" },
    format: { type: "string", choices: ["json", "text"], default: "json" },
    help: { type: "boolean" },
  });
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  for (const name of ["godot", "python", "uv", "gdtoolkit"] as const) {
    validateVersion(options[name], `--${name}`);
  }
  options.source = validateRelativePath(options.source, "--source");
  pythonRequirement(options.python);

  const root = resolveRoot(options.root);
  const workspace = new Workspace(root);
  if (workspace.read("project.godot") === null) {
    throw new InitError("project.godot is missing; --root must be a Godot project", EXIT.ENVIRONMENT);
  }
  configurePackage(workspace, options.source);
  configureMise(workspace, options);
  configurePyproject(workspace, options, root);
  workspace.stage("scripts/check-gdscript.mjs", CHECK_GDSCRIPT, { createOnly: true, mode: 0o755 });
  workspace.appendLine(".gitignore", ".godot/");
  workspace.appendLine(".gitignore", ".venv/");

  const miseConfig = workspace.path("mise.toml");
  const commands = [
    { command: "mise", args: ["trust", miseConfig] },
    { command: "mise", args: ["install"] },
    { command: "mise", args: ["exec", "--", "uv", "lock"] },
    { command: "mise", args: ["exec", "--", "uv", "sync", "--locked"] },
  ];
  const mode = options.apply ? "apply" : "plan";
  const files = workspace.plannedFiles();
  if (options.apply) workspace.apply();
  if (options.install) {
    runCommand(root, "mise", ["trust", miseConfig]);
    runCommand(root, "mise", ["install"]);
    runCommand(root, "mise", ["exec", "--", "uv", "lock"]);
    runCommand(root, "mise", ["exec", "--", "uv", "sync", "--locked"]);
  }

  emit(
    {
      skill: "init-project",
      language: "gdscript",
      mode,
      root,
      selected: {
        godot: options.godot,
        python: options.python,
        uv: options.uv,
        gdtoolkit: options.gdtoolkit,
        source: options.source,
      },
      pythonDependencies: { dev: [`gdtoolkit==${options.gdtoolkit}`] },
      scripts: gdscriptScripts(options.source),
      operations: workspace.operations,
      files,
      pending: options.install ? [] : commands,
      installed: Boolean(options.install),
    },
    options.format,
  );
}

main().catch((error) => handleError(error, HELP));
