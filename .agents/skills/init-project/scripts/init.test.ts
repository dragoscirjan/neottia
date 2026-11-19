import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";
import { ensureTomlTask } from "./lib.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "init.ts");

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "init-project-test-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function run(root: string, extra: readonly string[] = []) {
  return spawnSync(
    process.execPath,
    [script, "--root", root, "--node", "24", "--pnpm", "10.33.0", ...extra],
    { encoding: "utf8" },
  );
}

test("aggregate task wiring refuses recognized failing placeholders but preserves real checks", () => {
  for (const command of [
    "echo 'typecheck is not configured' >&2; exit 1",
    'printf "typecheck not yet configured"; exit 1',
  ]) {
    for (const run of [JSON.stringify(command), JSON.stringify([command])]) {
      const text = "[tasks.typecheck]\nrun = " + run + "\n";
      assert.throws(() => ensureTomlTask(text, "typecheck", { depends: ["typecheck:typescript"] }), /Unconfigured aggregate task typecheck.*reconcile/i);
    }
  }
  const text = '[tasks.typecheck]\nrun = "pnpm run typecheck:legacy"\n';
  const merged = ensureTomlTask(text, "typecheck", { depends: ["typecheck:typescript"] });
  assert.match(merged, /run = "pnpm run typecheck:legacy"/);
  assert.match(merged, /depends = \["typecheck:typescript"\]/);
});

test("help documents safeguards and exit codes", () => {
  assert.equal(typeof Bun.TOML.parse, "function");
  const result = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--apply --confirm/);
  assert.match(result.stdout, /Exit codes:/);
});

test("the executable hard-stops when Bun is unavailable", () => {
  const result = spawnSync(script, ["--help"], {
    encoding: "utf8",
    env: { ...process.env, PATH: "/bun-is-intentionally-unavailable" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /bun/i);
});

test("Bun TOML parsing accepts equivalent existing values", () => {
  const root = fixture();
  try {
    writeFileSync(
      join(root, "mise.toml"),
      "[settings]\nlockfile = true # preserve comment\n\n[tools]\nnode = '24'\npnpm = '10.33.0'\n",
    );
    const plan = run(root);
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(readFileSync(join(root, "mise.toml"), "utf8").includes("preserve comment"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid TOML stops before mutation", () => {
  const root = fixture();
  try {
    const misePath = join(root, "mise.toml");
    writeFileSync(misePath, "[tools\nnode = '24'\n");
    const before = readFileSync(misePath, "utf8");
    const result = run(root, ["--apply", "--confirm"]);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /Invalid TOML document/);
    assert.equal(readFileSync(misePath, "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated TOML conflicts are named before mutation", () => {
  const root = fixture();
  try {
    const misePath = join(root, "mise.toml");
    writeFileSync(misePath, '[tasks]\nvalidate = "custom"\n');
    const before = readFileSync(misePath, "utf8");
    const result = run(root, ["--apply", "--confirm"]);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /Conflict while updating tasks\.validate/);
    assert.equal(readFileSync(misePath, "utf8"), before);
    assert.equal(existsSync(join(root, "package.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Node versions below 24 are rejected", () => {
  const root = fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [script, "--root", root, "--node", "22.13.0", "--pnpm", "10.33.0"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Node 24 or newer/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plan is non-mutating and apply is idempotent", () => {
  const root = fixture();
  try {
    const plan = run(root);
    assert.equal(plan.status, 0, plan.stderr);
    const planData = JSON.parse(plan.stdout);
    assert.equal(planData.mode, "plan");
    assert.equal(planData.selected.node, "24");
    assert.equal(planData.devDependencies.husky, "9.1.7");
    assert.equal(planData.pnpmOverrides["argparse@1.0.10"], "2.0.1");
    assert.match(planData.hooks["pre-commit"], /mise run format/);
    const plannedFiles = Object.fromEntries(planData.files.map((file: { path: string; content: string }) => [file.path, file.content]));
    assert.match(plannedFiles["package.json"], /"argparse@1\.0\.10": "2\.0\.1"/);
    assert.match(plannedFiles["mise.toml"], /tasks\."validate"/);
    assert.match(plannedFiles["eslint.config.mjs"], /tempelEslintConfig/);
    assert.equal(existsSync(join(root, "mise.toml")), false);

    const unconfirmed = run(root, ["--apply"]);
    assert.equal(unconfirmed.status, 2);
    assert.equal(existsSync(join(root, "mise.toml")), false);

    const first = run(root, ["--apply", "--confirm"]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).mode, "apply");
    assert.equal(existsSync(join(root, "package.json")), true);
    assert.match(readFileSync(join(root, "mise.toml"), "utf8"), /deps:sync:pnpm/);
    assert.notEqual(statSync(join(root, ".husky", "pre-commit")).mode & 0o111, 0);

    const before = readFileSync(join(root, "mise.toml"), "utf8");
    const second = run(root, ["--apply", "--confirm"]);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(join(root, "mise.toml"), "utf8"), before);
    assert.ok(JSON.parse(second.stdout).operations.every(
      (operation: { action: string }) => operation.action === "unchanged",
    ));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("planned file contents redact pre-existing sensitive values", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "package.json"), '{"private":true,"authToken":"do-not-print"}\n');
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /do-not-print/);
    const packagePlan = JSON.parse(result.stdout).files.find(
      (file: { path: string }) => file.path === "package.json",
    );
    assert.equal(packagePlan.redacted, true);
    assert.match(packagePlan.content, /<redacted>/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("conflicting scripts stop before any file is changed", () => {
  const root = fixture();
  try {
    assert.equal(run(root, ["--apply", "--confirm"]).status, 0);
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.scripts.lint = "custom-lint";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const miseBefore = readFileSync(join(root, "mise.toml"), "utf8");

    const result = run(root, ["--apply", "--confirm"]);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /Conflict at package\.json\.scripts\.lint/);
    assert.equal(readFileSync(join(root, "mise.toml"), "utf8"), miseBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
