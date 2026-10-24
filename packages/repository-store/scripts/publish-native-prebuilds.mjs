import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNativeManifest, readPackageVersion, sha256 } from './native-prebuild.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function publishNativePrebuilds({ root = packageRoot, inputDirectory, runGhCommand = runGh } = {}) {
  if (inputDirectory === undefined) throw new Error('A native prebuild input directory is required.');
  const version = readPackageVersion(root);
  const manifest = readNativeManifest(root, version);
  if (manifest === undefined) throw new Error('The published package has no native prebuild manifest.');
  const input = resolve(inputDirectory);
  const files = [
    join(root, 'native-prebuilds.json'),
    ...manifest.artifacts.flatMap((artifact) => [
      join(input, artifact.name),
      join(input, artifact.bundle),
      join(input, artifact.attestation),
    ]),
  ];
  const existing = JSON.parse(runGhCommand(['release', 'view', manifest.releaseTag, '--json', 'assets'])).assets;
  const temporary = mkdtempSync(join(tmpdir(), 'neottia-native-assets-'));
  const missing = [];
  try {
    for (const file of files) {
      const name = basename(file);
      const asset = existing.find((candidate) => candidate.name === name);
      if (asset === undefined) {
        missing.push(file);
        continue;
      }
      runGhCommand(['release', 'download', manifest.releaseTag, '--pattern', name, '--dir', temporary]);
      const remote = readFileSync(join(temporary, name));
      const local = readFileSync(file);
      if (remote.byteLength !== local.byteLength || sha256(remote) !== sha256(local))
        throw new Error(`GitHub Release asset ${name} already exists with different bytes.`);
    }
    if (missing.length > 0) runGhCommand(['release', 'upload', manifest.releaseTag, ...missing]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return { status: 'published', uploaded: missing.map((file) => basename(file)) };
}

function runGh(arguments_) {
  const result = spawnSync('gh', arguments_, { encoding: 'utf8', shell: false });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`gh ${arguments_[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    publishNativePrebuilds({ inputDirectory: option('--input') });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
