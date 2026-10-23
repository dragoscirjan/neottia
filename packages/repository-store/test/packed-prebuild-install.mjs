import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleNativePrebuilds } from '../scripts/assemble-native-prebuilds.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactDirectory = resolve(process.argv[2] ?? 'native-prebuilds');
const temporary = mkdtempSync(join(tmpdir(), 'neottia-packed-native-'));
const server = createServer((request, response) => {
  const name = basename(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname));
  const allowed = readdirSync(artifactDirectory).includes(name);
  if (!allowed) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'application/octet-stream' });
  response.end(readFileSync(join(artifactDirectory, name)));
});

try {
  await assembleNativePrebuilds({ root: packageRoot, inputDirectory: artifactDirectory, allowPartial: true });
  const packDirectory = join(temporary, 'pack');
  mkdirSync(packDirectory);
  await runPnpm(['pack', '--pack-destination', packDirectory], packageRoot);
  const tarballName = readdirSync(packDirectory).find((name) => name.endsWith('.tgz'));
  assert.notEqual(tarballName, undefined);
  const tarball = join(packDirectory, tarballName);

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  const verifiedProject = join(temporary, 'verified');
  createProject(verifiedProject, tarball);
  await runPnpm(['install'], verifiedProject, {
    NEOTTIA_REPOSITORY_STORE_PREBUILD_BASE_URL: `http://127.0.0.1:${String(address.port)}`,
  });
  assert.equal(readReceipt(verifiedProject).origin, 'verified-prebuilt');

  const sourceProject = join(temporary, 'source');
  createProject(sourceProject, tarball);
  await runPnpm(['install'], sourceProject, { NEOTTIA_REPOSITORY_STORE_FORCE_SOURCE_BUILD: '1' });
  assert.equal(readReceipt(sourceProject).origin, 'source-build');
  console.log('packed native prebuild and source fallback journeys passed');
} finally {
  if (server.listening) server.close();
  rmSync(join(packageRoot, 'native-prebuilds.json'), { force: true });
  rmSync(temporary, { recursive: true, force: true });
}

function createProject(path, tarball) {
  mkdirSync(path, { recursive: true });
  const packageJson = {
    private: true,
    dependencies: { '@neottia/repository-store': `file:${tarball}` },
    pnpm: { onlyBuiltDependencies: ['@neottia/repository-store'] },
  };
  writeFileSync(join(path, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
}

function readReceipt(project) {
  const installed = realpathSync(join(project, 'node_modules', '@neottia', 'repository-store'));
  return JSON.parse(
    readFileSync(join(installed, 'build', 'Release', 'repository_store_native.integrity.json'), 'utf8'),
  );
}

function runPnpm(arguments_, cwd, environment = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', arguments_, {
      cwd,
      env: { ...process.env, ...environment },
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`pnpm ${arguments_[0]} failed with ${signal ?? `status ${String(code)}`}.`));
    });
  });
}
