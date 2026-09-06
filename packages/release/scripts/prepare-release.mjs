#!/usr/bin/env node

/**
 * Prepares an immutable global release from the current publishable modules.
 * The meta-package uses exact workspace versions, which pnpm converts to exact
 * registry versions when the package is packed or published.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const releaseDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(releaseDirectory, '../..');
const globalVersion = process.argv.slice(2).find((argument) => argument !== '--');

if (!globalVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(globalVersion)) {
  console.error('Usage: mise run release:global -- <semver>');
  process.exit(1);
}

/** Reads direct child package manifests from a module directory. */
function readModules(directoryName) {
  const root = path.join(repositoryRoot, directoryName);
  if (!fs.existsSync(root)) return [];

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'package.json'))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .map((manifestPath) => JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
    .filter((manifest) => !manifest.private && manifest.name !== '@neottia/release');
}

const modules = [...readModules('packages'), ...readModules('extensions')].sort((left, right) =>
  left.name.localeCompare(right.name),
);
const moduleVersions = Object.fromEntries(modules.map(({ name, version }) => [name, version]));
const exactWorkspaceDependencies = Object.fromEntries(
  modules.map(({ name, version }) => [name, `workspace:${version}`]),
);

const packagePath = path.join(releaseDirectory, 'package.json');
const releasePackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
releasePackage.version = globalVersion;
releasePackage.dependencies = exactWorkspaceDependencies;

fs.writeFileSync(packagePath, `${JSON.stringify(releasePackage, null, 2)}\n`);
fs.writeFileSync(
  path.join(releaseDirectory, 'release-manifest.json'),
  `${JSON.stringify({ version: globalVersion, modules: moduleVersions }, null, 2)}\n`,
);

console.log(`Prepared Neottia ${globalVersion} with ${modules.length} module(s).`);
