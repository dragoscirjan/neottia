import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleNativePrebuilds } from '../../repository-store/scripts/assemble-native-prebuilds.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const repositoryStoreRoot = join(repositoryRoot, 'packages', 'repository-store');
const fixture = join(repositoryRoot, 'packages', 'cli', 'test', 'external-consumer.fixture.mjs');
const args = parseArguments(process.argv.slice(2));
// Native MSBuild still enforces legacy path ceilings on hosted Windows.
// Use the workspace drive root and short directory names for packed installs.
const temporaryBase = process.platform === 'win32' ? parse(repositoryRoot).root : tmpdir();
const temporary = mkdtempSync(join(temporaryBase, process.platform === 'win32' ? 'nt-' : 'neottia-packed-external-'));
const manifestPath = join(repositoryStoreRoot, 'native-prebuilds.json');
const originalManifest = existsSync(manifestPath) ? readFileSync(manifestPath) : undefined;
let server;

try {
  await run('pnpm', ['-r', 'run', '--if-present', 'build'], repositoryRoot);
  let prebuildBaseUrl;
  if (args.mode === 'prebuilt') {
    assert.ok(args.artifacts, '--artifacts is required in prebuilt mode');
    await assembleNativePrebuilds({ root: repositoryStoreRoot, inputDirectory: args.artifacts, allowPartial: true });
    server = createArtifactServer(args.artifacts);
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, 'object');
    prebuildBaseUrl = `http://127.0.0.1:${String(address.port)}`;
  } else {
    rmSync(manifestPath, { force: true });
  }

  const packDirectory = join(temporary, 'packs');
  mkdirSync(packDirectory);
  const packages = discoverPackages();
  const tarballs = new Map();
  for (const candidate of packages) {
    const before = new Set(readdirSync(packDirectory));
    await run('pnpm', ['pack', '--pack-destination', packDirectory], candidate.directory);
    const created = readdirSync(packDirectory).filter((name) => !before.has(name) && name.endsWith('.tgz'));
    assert.equal(created.length, 1, `Expected one tarball for ${candidate.name}`);
    tarballs.set(candidate.name, join(packDirectory, created[0]));
  }

  const project = join(temporary, 'consumer');
  const home = join(temporary, 'home');
  const xdgConfig = join(temporary, 'xdg-config');
  const xdgState = join(temporary, 'xdg-state');
  for (const path of [project, home, xdgConfig, xdgState]) mkdirSync(path, { recursive: true });
  const localPackages = Object.fromEntries([...tarballs].map(([name, tarball]) => [name, fileSpecification(tarball)]));
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        packageManager: 'pnpm@10.28.2',
        dependencies: localPackages,
        devDependencies: { tsx: '^4.23.15' },
        pnpm: {
          onlyBuiltDependencies: ['@neottia/repository-store'],
          overrides: localPackages,
        },
      },
      null,
      2,
    )}\n`,
  );
  copyFileSync(fixture, join(project, 'external-consumer.mjs'));

  const environment = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_STATE_HOME: xdgState,
    ...(args.mode === 'source'
      ? { NEOTTIA_REPOSITORY_STORE_FORCE_SOURCE_BUILD: '1' }
      : { NEOTTIA_REPOSITORY_STORE_PREBUILD_BASE_URL: prebuildBaseUrl }),
  };
  const installArguments = ['install', '--store-dir', join(temporary, 's')];
  if (process.platform === 'win32') installArguments.push('--virtual-store-dir', join(temporary, 'v'));
  await run('pnpm', installArguments, project, environment);

  const cli = join(project, 'node_modules', '@neottia', 'cli', 'dist', 'cli.js');
  await run(
    process.execPath,
    [
      cli,
      'init',
      '--harness',
      'pi',
      '--harness',
      'opencode',
      '--harness',
      'claude-code',
      '--enable',
      'memory',
      '--enable',
      'searchable',
    ],
    project,
    environment,
  );
  await run(process.execPath, [cli, 'apply'], project, environment);
  const doctor = await run(process.execPath, [cli, 'doctor', '--json'], project, environment);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.status, 'pass');
  assert.equal(report.repositoryStore.status, 'pass');
  assert.equal(report.configuration.status, 'pass');
  assert.deepEqual(report.configuration.harnesses, ['claude-code', 'opencode', 'pi']);

  await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'tsx', 'external-consumer.mjs'], project, {
    ...environment,
    EXPECTED_NATIVE_ORIGIN: args.mode === 'source' ? 'source-build' : 'verified-prebuilt',
  });
  console.log(`packed external journey passed in ${args.mode} mode for ${process.platform}-${process.arch}`);
} finally {
  await closeServer(server);
  if (originalManifest === undefined) rmSync(manifestPath, { force: true });
  else writeFileSync(manifestPath, originalManifest);
  rmSync(temporary, { recursive: true, force: true });
}

function parseArguments(values) {
  const modeIndex = values.indexOf('--mode');
  const artifactsIndex = values.indexOf('--artifacts');
  const mode = modeIndex === -1 ? undefined : values[modeIndex + 1];
  if (mode !== 'source' && mode !== 'prebuilt') {
    throw new TypeError('Usage: packed-external-journey.mjs --mode source|prebuilt [--artifacts DIR]');
  }
  return {
    mode,
    artifacts: artifactsIndex === -1 ? undefined : resolve(values[artifactsIndex + 1]),
  };
}

function discoverPackages() {
  const packages = [];
  for (const collection of ['packages', 'extensions']) {
    const root = join(repositoryRoot, collection);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(root, entry.name);
      const manifest = join(directory, 'package.json');
      if (!existsSync(manifest)) continue;
      const value = JSON.parse(readFileSync(manifest, 'utf8'));
      if (value.private || value.name === '@neottia/release') continue;
      packages.push({ name: value.name, directory });
    }
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

function fileSpecification(path) {
  return `file:${path.split(sep).join('/')}`;
}

function createArtifactServer(directory) {
  const allowed = new Set(readdirSync(directory));
  return createServer((request, response) => {
    const name = basename(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname));
    if (!allowed.has(name)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(readFileSync(join(directory, name)));
  });
}

function listen(value) {
  return new Promise((resolveListen, reject) => {
    value.once('error', reject);
    value.listen(0, '127.0.0.1', resolveListen);
  });
}

function closeServer(value) {
  if (value === undefined || !value.listening) return Promise.resolve();
  return new Promise((resolveClose, reject) => value.close((error) => (error ? reject(error) : resolveClose())));
}

function run(command, arguments_, cwd, environment = process.env) {
  return new Promise((resolveRun, reject) => {
    const pnpmCommand = command === 'pnpm' || command === 'pnpm.cmd';
    const executable = pnpmCommand ? 'pnpm' : command;
    const child = spawn(executable, arguments_, {
      cwd,
      env: environment,
      // Windows requires its command shell for the pnpm.cmd shim. Every
      // argument passed by this acceptance script is repository-owned.
      shell: process.platform === 'win32' && pnpmCommand,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      const output = `${stdout}\n${stderr}`;
      const hiddenFailure = /\bFAIL\b|::error|Report experimental failure|ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL/u.exec(
        output,
      );
      if (code === 0 && hiddenFailure === null) {
        resolveRun({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          hiddenFailure === null
            ? `${relative(repositoryRoot, cwd)}: ${executable} ${arguments_[0] ?? ''} failed with ${signal ?? `status ${String(code)}`}.`
            : `${relative(repositoryRoot, cwd)}: hidden failure marker ${hiddenFailure[0]} was present.`,
        ),
      );
    });
  });
}
