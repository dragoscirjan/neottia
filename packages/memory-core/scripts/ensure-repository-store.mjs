import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryStore = fileURLToPath(new URL('../../repository-store/', import.meta.url));
const sourceRoot = join(repositoryStore, 'src');
const sourceInputs = filesUnder(sourceRoot).filter(isBuildInput);
const compiledSources = sourceInputs.filter(isCompiledSource);
const packageInputs = [
  join(repositoryStore, 'package.json'),
  join(repositoryStore, 'tsconfig.build.json'),
  join(repositoryStore, 'tsconfig.json'),
  ...sourceInputs,
];
const nativeInputs = [
  join(repositoryStore, 'package.json'),
  join(repositoryStore, 'binding.gyp'),
  ...filesUnder(join(repositoryStore, 'native')),
];
const ready =
  compiledSources.every((source) =>
    compiledOutputs(source).every((output) => outputIsCurrent(output, packageInputs)),
  ) && outputIsCurrent(join(repositoryStore, 'build/Release/repository_store_native.node'), nativeInputs);

// Focused Memory tests may start from a clean checkout, while root validation
// already supplies current outputs and must not race-rebuild the dependency.
if (!ready) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const build = spawnSync(command, ['--filter', '@neottia/repository-store', 'build'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    stdio: 'inherit',
  });
  if (build.error !== undefined) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
}

/** Lists every regular file below one build-input directory. */
function filesUnder(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : entry.isFile() ? [child] : [];
  });
}

/** Mirrors the source exclusions in repository-store's build configuration. */
function isBuildInput(path) {
  return path.endsWith('.ts') && !/\.(?:fixture|spec|test)\.ts$/u.test(path) && basename(path) !== 'test-contract.ts';
}

/** Identifies TypeScript inputs that emit their own output set. */
function isCompiledSource(path) {
  return !path.endsWith('.d.ts');
}

/** Returns all files emitted for one compiled TypeScript source. */
function compiledOutputs(source) {
  const outputBase = join(repositoryStore, 'dist', relative(sourceRoot, source).slice(0, -3));
  return [`${outputBase}.js`, `${outputBase}.js.map`, `${outputBase}.d.ts`, `${outputBase}.d.ts.map`];
}

/** Checks that an output exists and is no older than every source input. */
function outputIsCurrent(output, inputs) {
  try {
    const outputTime = statSync(output).mtimeMs;
    return inputs.every((input) => statSync(input).mtimeMs <= outputTime);
  } catch {
    return false;
  }
}
