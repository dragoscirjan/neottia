import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig as resolvePrettierConfig } from 'prettier';
import { parseDocument } from 'yaml';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = resolve(repositoryRoot, 'docs/reference/dependencies.md');
const writeReference = process.argv.includes('--write');

/** Reads and parses one package manifest. */
function readManifest(file) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8'));
}

/** Expands the repository's supported one-level pnpm workspace patterns. */
function workspaceManifests() {
  const workspace = parseDocument(readFileSync(resolve(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8'), {
    strict: true,
    uniqueKeys: true,
  }).toJS();
  return (workspace.packages ?? [])
    .flatMap((pattern) => {
      const match = /^(.*)\/\*$/u.exec(pattern);
      if (!match?.[1]) throw new Error(`Unsupported workspace pattern in dependency reference: ${pattern}`);
      return readdirSync(resolve(repositoryRoot, match[1]), { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && existsSync(resolve(repositoryRoot, match[1], entry.name, 'package.json')),
        )
        .map((entry) => `${match[1]}/${entry.name}/package.json`);
    })
    .sort();
}

/** Renders exact values as HTML code without letting pipes split Markdown table cells. */
function markdownCode(value) {
  const escaped = String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;');
  return `<code>${escaped}</code>`;
}

/** Formats all direct dependency declarations as narrow, readable table rows. */
function dependencyRows(manifest) {
  const classifications = [
    ['Runtime', manifest.dependencies],
    ['Peer', manifest.peerDependencies],
    ['Optional', manifest.optionalDependencies],
    ['Development', manifest.devDependencies],
  ];
  const rows = classifications.flatMap(([classification, dependencies]) =>
    Object.entries(dependencies ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, range]) => {
        const optionalPeer =
          classification === 'Peer' && manifest.peerDependenciesMeta?.[name]?.optional === true
            ? ' (optional peer)'
            : '';
        return `| ${classification} | ${markdownCode(name)}${optionalPeer} | ${markdownCode(range)} |`;
      }),
  );
  return rows.length === 0 ? ['| None | None | None |'] : rows;
}

/** Formats an exact manifest object as key/value declarations. */
function declarationCell(values) {
  const entries = Object.entries(values ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return 'None';
  return entries.map(([name, value]) => `${markdownCode(name)} ${markdownCode(value)}`).join('<br>');
}

/** Links a generated row to its authoritative package manifest. */
function manifestLink(file) {
  return `[${markdownCode(file)}](https://github.com/dragoscirjan/neottia/blob/main/${file})`;
}

/** Renders the complete manifest-backed dependency reference. */
function renderReference() {
  const root = readManifest('package.json');
  const modules = workspaceManifests()
    .map((file) => ({ file, manifest: readManifest(file) }))
    .sort(({ manifest: left }, { manifest: right }) => left.name.localeCompare(right.name));
  const lines = [
    '# Dependency reference',
    '',
    'This page lists the direct package declarations from the root `package.json` and every workspace module manifest. The declared ranges appear exactly as they do in the manifests. The [`pnpm-lock.yaml`](https://github.com/dragoscirjan/neottia/blob/main/pnpm-lock.yaml) file records the resolved transitive dependency tree.',
    '',
    "Use the [requirements page](/get-started/requirements) for operating systems, filesystems, native build tools, services, and supported runtime combinations. Use the [module catalog](/reference/modules) for each module's delivery classification and canonical documentation.",
    '',
    '## How to read this reference',
    '',
    '- Runtime dependencies install with the package.',
    '- Peer dependencies must be available in the consuming environment.',
    '- Optional dependencies may be absent without making the base package unusable.',
    '- Development dependencies support repository builds, tests, linting, documentation, or package-specific fixtures. They are not user runtime requirements.',
    '- A `workspace:` range names another package in this monorepo. pnpm converts `workspace:*`, `workspace:^`, and `workspace:~` to ordinary published version ranges when it packs a module.',
    '',
    '## Repository toolchain',
    '',
    '| Declaration | Exact value |',
    '| --- | --- |',
    `| Root package | ${markdownCode(root.name)} |`,
    `| Root version | ${markdownCode(root.version ?? 'Not declared')} |`,
    `| Root private field | ${markdownCode(root.private === undefined ? 'Not declared' : root.private)} |`,
    `| Package manager | ${markdownCode(root.packageManager ?? 'Not declared')} |`,
    `| Engines | ${declarationCell(root.engines)} |`,
    `| pnpm overrides | ${declarationCell(root.pnpm?.overrides)} |`,
    '',
    '### Root package dependencies',
    '',
    '| Classification | Dependency | Exact range |',
    '| --- | --- | --- |',
    ...dependencyRows(root),
    '',
    '## Workspace module dependencies',
    '',
    'Each module section lists its runtime, peer, optional, and package-local development declarations. Root development dependencies still apply to repository-wide tasks.',
    '',
    ...modules.flatMap(({ file, manifest }) => {
      const platform = declarationCell({
        ...(manifest.os ? { os: manifest.os.join(', ') } : {}),
        ...(manifest.cpu ? { cpu: manifest.cpu.join(', ') } : {}),
      });
      return [
        `### ${markdownCode(manifest.name)}`,
        '',
        '| Declaration | Exact value |',
        '| --- | --- |',
        `| Manifest | ${manifestLink(file)} |`,
        `| Version | ${markdownCode(manifest.version ?? 'Not declared')} |`,
        `| Private field | ${markdownCode(manifest.private === undefined ? 'Not declared' : manifest.private)} |`,
        `| Engines | ${declarationCell(manifest.engines)} |`,
        `| Platform declarations | ${platform} |`,
        '',
        '| Classification | Dependency | Exact range |',
        '| --- | --- | --- |',
        ...dependencyRows(manifest),
        '',
      ];
    }),
  ];
  return lines.join('\n');
}

const prettierConfig = (await resolvePrettierConfig(outputFile)) ?? {};
const rendered = await format(renderReference(), { ...prettierConfig, filepath: outputFile });

if (writeReference) {
  writeFileSync(outputFile, rendered);
  process.stdout.write(`wrote ${relative(repositoryRoot, outputFile)}\n`);
} else {
  if (!existsSync(outputFile) || readFileSync(outputFile, 'utf8') !== rendered) {
    throw new Error('docs/reference/dependencies.md is stale; run mise run docs:dependencies:generate');
  }
  process.stdout.write('dependency reference matches all package manifests\n');
}
