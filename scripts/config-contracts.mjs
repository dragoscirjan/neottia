import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format, resolveConfig as resolvePrettierConfig } from 'prettier';
import { OFFICIAL_CONFIG_CONTRIBUTIONS } from './config-contributions.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaFile = resolve(repositoryRoot, 'packages/config/config.schema.json');
const writeSchema = process.argv.includes('--write');

/** Loads the generic generator and built official registry. */
async function loadRegistry() {
  const configModule = await importBuiltModule('packages/config/dist/index.js');
  const registryModule = await importBuiltModule('packages/config-registry/dist/index.js');
  return {
    generate: configModule.generateConfigJsonSchema,
    registry: registryModule.officialConfigRegistry,
  };
}

/** Imports one build output and explains how to produce it when absent. */
async function importBuiltModule(file) {
  const absolute = resolve(repositoryRoot, file);
  if (!existsSync(absolute)) throw new Error(`${file} is missing; run mise run build first`);
  return import(pathToFileURL(absolute).href);
}

/** Finds every production TypeScript source beneath a directory. */
function sourceFiles(directory) {
  const absolute = resolve(repositoryRoot, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        !relative(absolute, entry.parentPath).split(/[\\/]/u).includes('node_modules') &&
        entry.name.endsWith('.ts') &&
        !/\.(?:spec|test)\.ts$/u.test(entry.name),
    )
    .map((entry) => resolve(entry.parentPath, entry.name));
}

/** Checks that every exported contribution appears in the official schema registry. */
function checkModuleCoverage() {
  const declared = [];
  for (const file of sourceFiles('packages')) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(
      /export\s+const\s+(\w+ConfigContribution)\s*=\s*defineConfigContribution\s*\(/gu,
    )) {
      declared.push({ exportName: match[1], sourceFile: relative(repositoryRoot, file) });
    }
  }
  const official = OFFICIAL_CONFIG_CONTRIBUTIONS.map(({ exportName, sourceFile }) => ({ exportName, sourceFile }));
  const render = (entries) => entries.map((entry) => `${entry.sourceFile}:${entry.exportName}`).sort();
  if (JSON.stringify(render(declared)) !== JSON.stringify(render(official))) {
    throw new Error(
      `official configuration contribution coverage is stale\ndeclared: ${render(declared).join(', ')}\nofficial: ${render(official).join(', ')}`,
    );
  }
}

/** Prevents a production module from coupling a YAML parser to Neottia's root file. */
function checkNoModuleLocalRootParser() {
  const violations = [];
  for (const file of [...sourceFiles('packages'), ...sourceFiles('extensions')]) {
    if (relative(repositoryRoot, file) === 'packages/config/src/resolver.ts') continue;
    const content = readFileSync(file, 'utf8');
    const namesRootFile = /\.neottia\/config\.ya?ml|NEOTTIA_CONFIG_FILE/u.test(content);
    const parsesYaml = /from\s+['"]yaml['"]|require\s*\(\s*['"]yaml['"]\s*\)/u.test(content);
    if (namesRootFile && parsesYaml) violations.push(relative(repositoryRoot, file));
  }
  if (violations.length > 0) {
    throw new Error(`module-local .neottia/config.yml parsing is forbidden: ${violations.sort().join(', ')}`);
  }
}

/** Confirms that the schema exposes every official canonical module and rejects unknown keys. */
function checkSchemaCoverage(schema) {
  const expected = OFFICIAL_CONFIG_CONTRIBUTIONS.map(({ path }) => path[1]).sort();
  const modules = schema.properties?.modules;
  const profileModules = schema.properties?.profiles?.additionalProperties?.properties?.modules;
  const actual = Object.keys(modules?.properties ?? {}).sort();
  const profileActual = Object.keys(profileModules?.properties ?? {}).sort();
  if (
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    JSON.stringify(profileActual) !== JSON.stringify(expected)
  ) {
    throw new Error('generated root schema does not cover every official module in base and profile configuration');
  }
  if (schema.additionalProperties !== false || modules?.additionalProperties !== false) {
    throw new Error('generated root schema must reject unknown root and module keys');
  }
}

const { generate, registry } = await loadRegistry();
if (typeof generate !== 'function') throw new Error('@neottia/config does not export generateConfigJsonSchema');
checkModuleCoverage();
checkNoModuleLocalRootParser();
const schema = generate(registry);
checkSchemaCoverage(schema);
const prettierConfig = (await resolvePrettierConfig(schemaFile)) ?? {};
const serialized = await format(JSON.stringify(schema), { ...prettierConfig, filepath: schemaFile });

if (writeSchema) {
  writeFileSync(schemaFile, serialized);
  process.stdout.write(`wrote ${relative(repositoryRoot, schemaFile)}\n`);
} else {
  if (!existsSync(schemaFile) || readFileSync(schemaFile, 'utf8') !== serialized) {
    throw new Error('packages/config/config.schema.json is stale; run mise run config:schema:generate');
  }
  process.stdout.write('configuration schema freshness, module coverage, and parser guard passed\n');
}
