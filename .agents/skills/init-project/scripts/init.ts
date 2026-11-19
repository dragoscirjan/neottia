#!/usr/bin/env bun

import {
  EXIT,
  InitError,
  Workspace,
  emit,
  ensureTomlTableKey,
  ensureTomlTask,
  handleError,
  mergeExactMap,
  parseArgs,
  readJsonObject,
  requireBun,
  requireGitRoot,
  resolveRoot,
  runCommand,
  setExact,
  validateVersion,
  writeJsonObject,
  type JsonObject,
  type TomlTaskDefinition,
} from "./lib.ts";

const HELP = `Usage:
  bun scripts/init.ts --root PATH --node VERSION --pnpm VERSION [--dry-run]
  bun scripts/init.ts --root PATH --node VERSION --pnpm VERSION --apply --confirm [--install]

Initializes the shared mise, pnpm, Tempel, and Husky project foundation.
The default mode is a dry-run plan. --apply requires --confirm. --install also
runs the approved tool and dependency synchronization commands.

Options:
  --root PATH       Existing Git repository root (required)
  --node VERSION    Pinned Node 24 or newer version or major
  --pnpm VERSION    Pinned pnpm version or major
  --dry-run         Explicitly select plan-only mode
  --apply           Write the planned files
  --confirm         Confirm that the printed plan received human approval
  --install         Run mise and pnpm after writing files; requires --apply
  --format FORMAT   Output format: json or text (default: json)
  --help            Show this help

Exit codes:
  0 success                  2 invalid arguments
  3 configuration conflict   4 missing environment prerequisite
  5 external command failed  6 filesystem or unexpected failure

Examples:
  bun scripts/init.ts --root /work/project --node 24 --pnpm 10.33.0
  bun scripts/init.ts --root /work/project --node 24 --pnpm 10.33.0 --apply --confirm --install`;

const DEV_DEPENDENCIES = Object.freeze({
  "@commitlint/cli": "21.2.4",
  "@tempel/commitlint": "1.1.0",
  "@tempel/eslint": "1.3.1",
  "@tempel/prettier": "1.1.0",
  eslint: "10.13.0",
  husky: "9.1.7",
  "import-sort-style-module": "6.0.0",
  jscpd: "5.4.1",
  prettier: "3.9.10",
  "prettier-plugin-import-sort": "0.0.7",
  "prettier-plugin-toml": "2.0.6",
  typescript: "5.9.3",
});

const PNPM_OVERRIDES = Object.freeze({
  "argparse@1.0.10": "2.0.1",
  "katex@0.16.47": "0.18.2",
});

const SCRIPTS = Object.freeze({
  prepare: "husky",
  lint: "eslint .",
  "lint:fix": "eslint . --fix",
  format: "prettier . --check",
  "format:fix": "prettier . --write",
  "code-duplicate": "jscpd --config .jscpd.json",
  audit: "pnpm audit",
  commitlint: "commitlint --config commitlint.config.mjs --edit",
});

const CONFIG_FILES: Readonly<Record<string, string>> = Object.freeze({
  "commitlint.config.mjs": `import commitlintConfig from '@tempel/commitlint';\n\nexport default commitlintConfig();\n`,
  "eslint.config.mjs": `import tempelEslintConfig from '@tempel/eslint';\n\nexport default [\n  {\n    ignores: ['.godot/**', '**/*.gd', 'project.godot'],\n  },\n  ...tempelEslintConfig,\n];\n`,
  "prettier.config.mjs": `import prettierConfig from '@tempel/prettier';\n\nexport default prettierConfig;\n`,
  ".prettierignore": `.gitignore\n.prettierignore\n.husky/\n.godot/\n**/*.gd\nproject.godot\nnode_modules/\ndist/\ncoverage/\npnpm-lock.yaml\nuv.lock\nmise.lock\n`,
  ".jscpd.json": `{
  "path": ["."],
  "ignore": [
    "**/.git/**",
    "**/.godot/**",
    "**/.husky/_/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    "pnpm-lock.yaml",
    "uv.lock",
    "mise.lock"
  ]
}\n`,
  ".husky/pre-commit": `mise run format && mise run lint\n`,
  ".husky/commit-msg": `pnpm exec commitlint --config commitlint.config.mjs --edit "$1"\n`,
  ".husky/pre-push": `mise run validate\n`,
});

function validateNodeVersion(value: string): string {
  validateVersion(value, "--node");
  const major = Number(value.match(/^(\d+)/)?.[1]);
  if (major < 24) {
    throw new InitError("--node must be Node 24 or newer", EXIT.USAGE);
  }
  return value;
}

function configureMise(
  workspace: Workspace,
  nodeVersion: string,
  pnpmVersion: string,
): void {
  let mise = workspace.read("mise.toml") ?? "";
  mise = ensureTomlTableKey(mise, "settings", "lockfile", "true");
  mise = ensureTomlTableKey(mise, "tools", "node", JSON.stringify(nodeVersion));
  mise = ensureTomlTableKey(mise, "tools", "pnpm", JSON.stringify(pnpmVersion));

  const tasks: readonly (readonly [string, TomlTaskDefinition])[] = [
    ["deps:sync:mise", { description: "Install tools pinned by mise", run: "mise install" }],
    ["deps:sync:pnpm", { description: "Install locked Node dependencies", run: "pnpm install --frozen-lockfile" }],
    ["deps:sync", { description: "Synchronize all locked project dependencies", depends: ["deps:sync:mise", "deps:sync:pnpm"] }],
    ["lint:check:project", { description: "Lint project source and configuration", run: "pnpm run lint" }],
    ["lint:fix:project", { description: "Apply approved project lint fixes", run: "pnpm run lint:fix" }],
    ["lint", { description: "Run non-mutating lint checks", depends: ["lint:check:project"] }],
    ["lint:fix", { description: "Apply approved lint fixes", depends: ["lint:fix:project"] }],
    ["format:check:project", { description: "Check project formatting", run: "pnpm run format" }],
    ["format:fix:project", { description: "Write project formatting changes", run: "pnpm run format:fix" }],
    ["format", { description: "Run non-mutating format checks", depends: ["format:check:project"] }],
    ["format:fix", { description: "Write approved formatting changes", depends: ["format:fix:project"] }],
    ["code-duplicate:project", { description: "Check first-party duplicate code", run: "pnpm run code-duplicate" }],
    ["code-duplicate", { description: "Run duplicate-code checks", depends: ["code-duplicate:project"] }],
    ["audit:node", { description: "Audit locked Node dependencies", run: "pnpm run audit" }],
    ["audit", { description: "Run configured dependency audits", depends: ["audit:node"] }],
    ["quality", { description: "Run the configured non-mutating quality gate", depends: ["format", "lint", "code-duplicate", "audit"] }],
    ["validate", { description: "Compatibility alias for the quality gate", depends: ["quality"] }],
  ];
  for (const [name, definition] of tasks) mise = ensureTomlTask(mise, name, definition);
  workspace.stage("mise.toml", mise);
}

function configurePackage(workspace: Workspace, pnpmVersion: string): void {
  const existed = workspace.read("package.json") !== null;
  const manifest = readJsonObject(workspace, "package.json", { private: true });
  if (!existed && !Object.hasOwn(manifest, "private")) manifest.private = true;
  setExact(manifest, "packageManager", `pnpm@${pnpmVersion}`, "package.json");
  mergeExactMap(manifest, "scripts", SCRIPTS, "package.json");
  mergeExactMap(manifest, "devDependencies", DEV_DEPENDENCIES, "package.json");
  if (!Object.hasOwn(manifest, "pnpm")) manifest.pnpm = {};
  const pnpm = manifest.pnpm;
  if (!pnpm || Array.isArray(pnpm) || typeof pnpm !== "object") {
    throw new InitError("package.json.pnpm must be an object", EXIT.CONFLICT);
  }
  mergeExactMap(pnpm as JsonObject, "overrides", PNPM_OVERRIDES, "package.json.pnpm");
  writeJsonObject(workspace, "package.json", manifest);
}

async function main(): Promise<void> {
  requireBun();
  const options = parseArgs(process.argv.slice(2), {
    root: { type: "string", required: true },
    node: { type: "string", required: true },
    pnpm: { type: "string", required: true },
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

  const root = resolveRoot(options.root);
  requireGitRoot(root);
  const nodeVersion = validateNodeVersion(options.node);
  const pnpmVersion = validateVersion(options.pnpm, "--pnpm");
  const workspace = new Workspace(root);

  configurePackage(workspace, pnpmVersion);
  configureMise(workspace, nodeVersion, pnpmVersion);
  for (const [file, content] of Object.entries(CONFIG_FILES)) {
    workspace.stage(file, content, {
      createOnly: true,
      ...(file.startsWith(".husky/") ? { mode: 0o755 } : {}),
    });
  }
  workspace.appendLine(".gitignore", "node_modules/");

  const miseConfig = workspace.path("mise.toml");
  const commands = [
    { command: "mise", args: ["trust", miseConfig] },
    { command: "mise", args: ["install"] },
    { command: "mise", args: ["exec", "--", "pnpm", "install"] },
  ];
  const mode = options.apply ? "apply" : "plan";
  const files = workspace.plannedFiles();
  if (options.apply) workspace.apply();
  if (options.install) {
    runCommand(root, "mise", ["trust", miseConfig]);
    runCommand(root, "mise", ["install"]);
    runCommand(root, "mise", ["exec", "--", "pnpm", "install"]);
  }

  emit(
    {
      skill: "init-project",
      mode,
      root,
      selected: { node: nodeVersion, pnpm: pnpmVersion },
      devDependencies: DEV_DEPENDENCIES,
      pnpmOverrides: PNPM_OVERRIDES,
      scripts: SCRIPTS,
      hooks: {
        "pre-commit": "mise run format && mise run lint",
        "commit-msg": "pnpm exec commitlint --config commitlint.config.mjs --edit \"$1\"",
        "pre-push": "mise run validate",
      },
      operations: workspace.operations,
      files,
      pending: options.install ? [] : commands,
      installed: Boolean(options.install),
    },
    options.format,
  );
}

main().catch((error) => handleError(error, HELP));
