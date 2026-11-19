import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

const scripts = dirname(fileURLToPath(import.meta.url));
const script = join(scripts, "init.ts");
const projectScript = resolve(scripts, "../init.ts");

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "init-typescript-test-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const result = spawnSync(
    process.execPath,
    [projectScript, "--root", root, "--node", "24", "--pnpm", "10.33.0", "--apply", "--confirm"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return root;
}

function run(root: string, extra: readonly string[] = []) {
  return spawnSync(
    process.execPath,
    [
      script,
      "--root",
      root,
      "--runtime",
      "node",
      "--module",
      "esm",
      "--kind",
      "app",
      "--node-types",
      "24.19.2",
      ...extra,
    ],
    { encoding: "utf8" },
  );
}

test("unconfigured aggregate tasks block apply without changing project files", () => {
  const root = fixture();
  try {
    const misePath = join(root, "mise.toml");
    const manifestPath = join(root, "package.json");
    const before = readFileSync(misePath, "utf8") + '\n[tasks.typecheck]\nrun = "echo \'typecheck is not configured\' >&2; exit 1"\n';
    writeFileSync(misePath, before);
    const manifest = readFileSync(manifestPath, "utf8");
    const result = run(root, ["--apply", "--confirm"]);
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /Unconfigured aggregate task typecheck.*reconcile/i);
    assert.equal(readFileSync(misePath, "utf8"), before);
    assert.equal(readFileSync(manifestPath, "utf8"), manifest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plan is non-mutating and apply requires confirmation", () => {
  const root = fixture();
  try {
    const plan = run(root);
    assert.equal(plan.status, 0, plan.stderr);
    const planData = JSON.parse(plan.stdout);
    assert.equal(planData.skill, "init-project");
    assert.equal(planData.language, "typescript");
    assert.equal(planData.selected.runtime, "node");
    assert.equal(planData.devDependencies.vitest, "4.1.11");
    assert.equal(planData.scripts.typecheck, "tsc --noEmit");
    const plannedFiles = Object.fromEntries(planData.files.map((file: { path: string; content: string }) => [file.path, file.content]));
    assert.match(plannedFiles["tsconfig.json"], /vitest\/globals/);
    assert.match(plannedFiles["vitest.config.ts"], /src\/\*\*\/\*\.test\.ts/);
    assert.match(plannedFiles["vitest.config.ts"], /test\/\*\*\/\*\.spec\.ts/);
    assert.equal(existsSync(join(root, "tsconfig.json")), false);

    const unconfirmed = run(root, ["--apply"]);
    assert.equal(unconfirmed.status, 2);
    assert.equal(existsSync(join(root, "tsconfig.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply is idempotent and registers TypeScript tasks", () => {
  const root = fixture();
  try {
    const first = run(root, ["--apply", "--confirm"]);
    assert.equal(first.status, 0, first.stderr);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(manifest.devDependencies.typescript, "5.9.3");
    assert.equal(manifest.scripts.typecheck, "tsc --noEmit");
    const mise = readFileSync(join(root, "mise.toml"), "utf8");
    assert.match(mise, /tasks\."typecheck:typescript"/);
    assert.match(mise, /"typecheck", "test", "build"/);

    const second = run(root, ["--apply", "--confirm"]);
    assert.equal(second.status, 0, second.stderr);
    assert.ok(JSON.parse(second.stdout).operations.every(
      (operation: { action: string }) => operation.action === "unchanged",
    ));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("custom test paths control discovery and cannot exclude all source", () => {
  const root = fixture();
  try {
    const custom = run(root, ["--tests", "checks"]);
    assert.equal(custom.status, 0, custom.stderr);
    const customFiles = Object.fromEntries(
      JSON.parse(custom.stdout).files.map(
        (file: { path: string; content: string }) => [file.path, file.content],
      ),
    );
    assert.match(customFiles["vitest.config.ts"], /checks\/\*\*\/\*\.test\.ts/);

    const overlap = run(root, ["--source", "src", "--tests", "src"]);
    assert.equal(overlap.status, 2);
    assert.match(overlap.stderr, /must not equal or contain --source/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("existing compiler configuration is never overwritten", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{"strict":false}}\n');
    const packageBefore = readFileSync(join(root, "package.json"), "utf8");
    const result = run(root, ["--apply", "--confirm"]);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /tsconfig\.json differs/);
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), packageBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
