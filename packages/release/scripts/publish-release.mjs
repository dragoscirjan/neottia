#!/usr/bin/env node

/**
 * Publishes a prepared global release only after every pinned module version is
 * publicly readable from npm. Existing global versions are skipped safely.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const releaseDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRegistry = 'https://registry.npmjs.org';

/** Builds the canonical registry URL for one scoped or unscoped package. */
function packageUrl(registry, packageName) {
  const encodedName = encodeURIComponent(packageName).replace('%40', '@');
  return `${registry.replace(/\/$/, '')}/${encodedName}`;
}

/** Reads public npm metadata, returning null when the package is absent. */
async function readPackageMetadata(packageName, registry, fetchImpl) {
  const response = await fetchImpl(packageUrl(registry, packageName), {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`npm returned HTTP ${response.status} for ${packageName}.`);
  }
  return response.json();
}

/** Extracts one exact version from a workspace dependency specification. */
function exactWorkspaceVersion(packageName, specification) {
  const match = /^workspace:(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(specification);
  if (!match) {
    throw new Error(`${packageName} must use an exact workspace version, received ${specification}.`);
  }
  return match[1];
}

/** Waits for npm's public registry to expose one exact package version. */
async function waitForPackageVersion(packageName, version, options) {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const metadata = await readPackageMetadata(packageName, options.registry, options.fetchImpl);
    if (metadata?.versions?.[version]) return;
    if (attempt < options.maxAttempts) await options.delayImpl(options.retryDelayMs);
  }
  throw new Error(`${packageName}@${version} is not publicly available from npm.`);
}

/** Publishes one prepared global release or skips an existing exact version. */
export async function publishPreparedRelease({
  manifest,
  packageDirectory = releaseDirectory,
  registry = process.env.npm_config_registry || defaultRegistry,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawnSync,
  delayImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 30,
  retryDelayMs = 10_000,
  log = console.log,
} = {}) {
  const releaseManifest =
    manifest ?? JSON.parse(await fs.readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
  const existingRelease = await readPackageMetadata(releaseManifest.name, registry, fetchImpl);
  if (existingRelease?.versions?.[releaseManifest.version]) {
    log(`${releaseManifest.name}@${releaseManifest.version} is already published.`);
    return 'skipped';
  }

  const dependencies = Object.entries(releaseManifest.dependencies ?? {});
  for (const [packageName, specification] of dependencies) {
    const version = exactWorkspaceVersion(packageName, specification);
    await waitForPackageVersion(packageName, version, {
      registry,
      fetchImpl,
      delayImpl,
      maxAttempts,
      retryDelayMs,
    });
  }

  if (!environment.NODE_AUTH_TOKEN) {
    throw new Error('Publishing the global release requires NODE_AUTH_TOKEN.');
  }

  const result = spawnImpl('pnpm', ['publish', '--access', 'public', '--no-git-checks', '--registry', registry], {
    cwd: packageDirectory,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Global release publication failed with exit code ${result.status ?? 1}.`);
  }

  log(`Published ${releaseManifest.name}@${releaseManifest.version}.`);
  return 'published';
}

/** Runs the publication command when this module is invoked as a script. */
async function main() {
  try {
    await publishPreparedRelease();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
