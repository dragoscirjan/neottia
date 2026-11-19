#!/usr/bin/env bun

import {
  EXIT,
  InitError,
  Workspace,
  emit,
  ensureTomlTask,
  formatJson,
  handleError,
  mergeExactMap,
  parseArgs,
  readJsonObject,
  requireBun,
  resolveRoot,
  runCommand,
  setExact,
  validateRelativePath,
  validateVersion,
  writeJsonObject,
  type JsonObject,
  type TomlTaskDefinition,
} from "../lib.ts";

type Runtime = "browser" | "node";
type ModuleKind = "commonjs" | "esm";
type ProjectKind = "app" | "library";

interface TypeScriptOptions {
  runtime: Runtime;
  module: ModuleKind;
  kind: ProjectKind;
  source: string;
  tests: string;
  typescript: string;
  vitest: string;
  "tempel-vitest": string;
  "node-types": string | undefined;
}

const HELP = `Usage:
  bun scripts/typescript/init.ts --root PATH --runtime node|browser --module esm|commonjs --kind app|library [options]
  bun scripts/typescript/init.ts --root PATH --runtime node|browser --module esm|commonjs --kind app|library --apply --confirm [--install]

Adds TypeScript configuration, pinned manifest dependencies, package scripts, and
mise tasks to an existing init-project foundation. The default mode is a dry-run.

Options:
  --root PATH             Existing initialized project root (required)
  --runtime RUNTIME       node or browser (required)
  --module MODULE         esm or commonjs (required)
  --kind KIND             app or library (required)
  --source PATH           Source directory (default: src)
  --tests PATH            Test directory (default: test)
  --typescript VERSION    Exact TypeScript version (default: 5.9.3)
  --vitest VERSION        Exact Vitest version (default: 4.1.11)
  --tempel-vitest VERSION Exact @tempel/vitest version (default: 0.3.2)
  --node-types VERSION    Exact @types/node version; required for Node targets
  --dry-run               Explicitly select plan-only mode
  --apply                 Write the planned files
  --confirm               Confirm that the complete TypeScript plan was approved
  --install               Run pnpm after writing files; requires --apply
  --format FORMAT         Output format: json or text (default: json)
  --help                  Show this help

Exit codes:
  0 success                  2 invalid arguments
  3 configuration conflict   4 missing environment prerequisite
  5 external command failed  6 filesystem or unexpected failure

Example:
  bun scripts/typescript/init.ts --root /work/project --runtime node --module esm --kind app --node-types 24.19.2
  bun scripts/typescript/init.ts --root /work/project --runtime node --module esm --kind app --node-types 24.19.2 --apply --confirm --install`;

function compilerOptions(options: TypeScriptOptions): JsonObject {
  const nodeTarget = options.runtime === "node";
  const esm = options.module === "esm";
  const result: JsonObject = {
    target: "ES2022",
    module: nodeTarget ? (esm ? "NodeNext" : "Node16") : esm ? "ESNext" : "CommonJS",
    moduleResolution: nodeTarget ? (esm ? "NodeNext" : "Node16") : esm ? "Bundler" : "Node",
    strict: true,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    forceConsistentCasingInFileNames: true,
    skipLibCheck: true,
  };
  result.types = nodeTarget ? ["node", "vitest/globals"] : ["vitest/globals"];
  if (!nodeTarget) result.lib = ["ES2022", "DOM", "DOM.Iterable"];
  return result;
}

function buildCompilerOptions(options: TypeScriptOptions): JsonObject {
  return {
    noEmit: false,
    outDir: "dist",
    rootDir: options.source,
    declaration: options.kind === "library",
    declarationMap: options.kind === "library",
    sourceMap: true,
  };
}

function vitestIncludes(options: TypeScriptOptions): string[] {
  const patterns: string[] = [];
  for (const root of new Set([options.source, options.tests])) {
    const prefix = root === "." ? "" : `${root}/`;
    for (const kind of ["test", "spec", "e2e"]) {
      patterns.push(`${prefix}**/*.${kind}.ts`);
    }
  }
  return patterns;
}

function vitestConfig(options: TypeScriptOptions): string {
  const includes = vitestIncludes(options)
    .map((pattern) => `    '${pattern}',`)
    .join("\n");
  return `import tempelVitestConfig from '@tempel/vitest';\n\nexport default tempelVitestConfig({\n  include: [\n${includes}\n  ],\n});\n`;
}

function configureMise(workspace: Workspace): void {
  let mise = workspace.read("mise.toml");
  if (mise === null) {
    throw new InitError("mise.toml is missing; run init-project first", EXIT.ENVIRONMENT);
  }
  const tasks: readonly (readonly [string, TomlTaskDefinition])[] = [
    ["typecheck:typescript", { description: "Type-check TypeScript without emitting output", run: "pnpm run typecheck" }],
    ["typecheck", { description: "Run configured static type checks", depends: ["typecheck:typescript"] }],
    ["test:typescript", { description: "Run TypeScript tests", run: "pnpm run test" }],
    ["test", { description: "Run configured tests", depends: ["test:typescript"] }],
    ["build:typescript", { description: "Build TypeScript outputs", run: "pnpm run build" }],
    ["build", { description: "Build configured outputs", depends: ["build:typescript"] }],
    ["quality", { depends: ["typecheck", "test", "build"] }],
  ];
  for (const [name, definition] of tasks) mise = ensureTomlTask(mise, name, definition);
  workspace.stage("mise.toml", mise);
}

function typescriptDependencies(options: TypeScriptOptions): JsonObject {
  const dependencies: JsonObject = {
    typescript: options.typescript,
    vitest: options.vitest,
    "@tempel/vitest": options["tempel-vitest"],
  };
  if (options.runtime === "node") {
    const nodeTypes = options["node-types"];
    if (nodeTypes === undefined) {
      throw new InitError("--node-types is required for a Node target", EXIT.USAGE);
    }
    dependencies["@types/node"] = nodeTypes;
  }
  return dependencies;
}

function configurePackage(workspace: Workspace, options: TypeScriptOptions): void {
  if (workspace.read("package.json") === null) {
    throw new InitError("package.json is missing; run init-project first", EXIT.ENVIRONMENT);
  }
  const manifest = readJsonObject(workspace, "package.json");
  if (!String(manifest.packageManager ?? "").startsWith("pnpm@")) {
    throw new InitError("package.json must declare the pnpm package manager from init-project", EXIT.CONFLICT);
  }
  setExact(manifest, "type", options.module === "esm" ? "module" : "commonjs", "package.json");
  mergeExactMap(
    manifest,
    "scripts",
    {
      typecheck: "tsc --noEmit",
      test: "vitest run",
      "test:watch": "vitest",
      build: "tsc -p tsconfig.build.json",
    },
    "package.json",
  );
  mergeExactMap(manifest, "devDependencies", typescriptDependencies(options), "package.json");
  writeJsonObject(workspace, "package.json", manifest);
}

async function main(): Promise<void> {
  requireBun();
  const options = parseArgs(process.argv.slice(2), {
    root: { type: "string", required: true },
    runtime: { type: "string", required: true, choices: ["node", "browser"] },
    module: { type: "string", required: true, choices: ["esm", "commonjs"] },
    kind: { type: "string", required: true, choices: ["app", "library"] },
    source: { type: "string", default: "src" },
    tests: { type: "string", default: "test" },
    typescript: { type: "string", default: "5.9.3" },
    vitest: { type: "string", default: "4.1.11" },
    "tempel-vitest": { type: "string", default: "0.3.2" },
    "node-types": { type: "string" },
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
  if (options.runtime === "node" && !options["node-types"]) {
    throw new InitError("--node-types is required for a Node target", EXIT.USAGE);
  }

  options.source = validateRelativePath(options.source, "--source");
  options.tests = validateRelativePath(options.tests, "--tests");
  if (
    options.tests === "." ||
    options.source === options.tests ||
    options.source.startsWith(`${options.tests}/`)
  ) {
    throw new InitError(
      "--tests must not equal or contain --source because the build excludes the test path",
      EXIT.USAGE,
    );
  }
  for (const name of ["typescript", "vitest", "tempel-vitest"] as const) {
    validateVersion(options[name], `--${name}`);
  }
  if (options["node-types"]) validateVersion(options["node-types"], "--node-types");

  const root = resolveRoot(options.root);
  const workspace = new Workspace(root);
  configurePackage(workspace, options);
  configureMise(workspace);

  const tsconfig = {
    compilerOptions: compilerOptions(options),
    include: [`${options.source}/**/*`, `${options.tests}/**/*`],
  };
  const buildConfig = {
    extends: "./tsconfig.json",
    compilerOptions: buildCompilerOptions(options),
    include: [`${options.source}/**/*`],
    exclude: [`${options.tests}/**/*`, "**/*.test.ts", "**/*.spec.ts"],
  };
  workspace.stage("tsconfig.json", formatJson(tsconfig), { createOnly: true });
  workspace.stage("tsconfig.build.json", formatJson(buildConfig), { createOnly: true });
  workspace.stage("vitest.config.ts", vitestConfig(options), { createOnly: true });

  const miseConfig = workspace.path("mise.toml");
  const commands = [
    { command: "mise", args: ["trust", miseConfig] },
    { command: "mise", args: ["exec", "--", "pnpm", "install"] },
  ];
  const mode = options.apply ? "apply" : "plan";
  const files = workspace.plannedFiles();
  if (options.apply) workspace.apply();
  if (options.install) {
    runCommand(root, "mise", ["trust", miseConfig]);
    runCommand(root, "mise", ["exec", "--", "pnpm", "install"]);
  }

  emit(
    {
      skill: "init-project",
      language: "typescript",
      mode,
      root,
      selected: {
        runtime: options.runtime,
        module: options.module,
        kind: options.kind,
        source: options.source,
        tests: options.tests,
      },
      devDependencies: typescriptDependencies(options),
      scripts: {
        typecheck: "tsc --noEmit",
        test: "vitest run",
        "test:watch": "vitest",
        build: "tsc -p tsconfig.build.json",
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
