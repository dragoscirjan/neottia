import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DesignDocumentStore, loadDesignDocsConfig } from '@neottia/design-docs';
import { IssueStore, loadIssueConfig } from '@neottia/issues';
import { loadMemoryConfig, MemoryStore } from '@neottia/memory-core';
import { loadSearchableConfig, SearchableStore } from '@neottia/searchable-core';

const project = process.cwd();
const origin = process.env.EXPECTED_NATIVE_ORIGIN;
assert.ok(origin === 'verified-prebuilt' || origin === 'source-build');

for (const path of [
  '.pi/prompts/plan.md',
  '.pi/settings.json',
  '.opencode/commands/plan.md',
  'opencode.json',
  '.claude/commands/plan.md',
  '.claude/skills/neottia-sdlc/SKILL.md',
  '.mcp.json',
]) {
  assert.ok((await readFile(join(project, path), 'utf8')).length > 0, `${path} was not installed`);
}

const piSettings = JSON.parse(await readFile(join(project, '.pi/settings.json'), 'utf8'));
const opencodeSettings = JSON.parse(await readFile(join(project, 'opencode.json'), 'utf8'));
const claudeMcp = JSON.parse(await readFile(join(project, '.mcp.json'), 'utf8'));
for (const logicalName of ['memory', 'issues', 'design-docs', 'searchable']) {
  assert.ok(piSettings.packages.some((entry) => entry.includes(`@neottia/pi-${logicalName}@`)));
  assert.ok(opencodeSettings.plugin.some((entry) => entry.includes(`@neottia/opencode-${logicalName}@`)));
}
for (const [server, packageName, executable] of [
  ['neottia-memory', '@neottia/memory-mcp', 'memory-mcp'],
  ['neottia-issues', '@neottia/issues-mcp', 'issues-mcp'],
  ['neottia-design-docs', '@neottia/design-docs-mcp', 'design-docs-mcp'],
  ['neottia-searchable', '@neottia/searchable-mcp', 'searchable-mcp'],
]) {
  const declaration = claudeMcp.mcpServers[server];
  assert.equal(declaration.type, 'stdio');
  assert.equal(declaration.command, 'npx');
  assert.deepEqual(declaration.args.slice(0, 2), ['--yes', '--package']);
  assert.ok(declaration.args[2].startsWith(`${packageName}@`));
  assert.equal(declaration.args[3], executable);
}

const extensionPackages = [
  '@neottia/pi-memory',
  '@neottia/pi-issues',
  '@neottia/pi-design-docs',
  '@neottia/pi-searchable',
  '@neottia/opencode-memory',
  '@neottia/opencode-issues',
  '@neottia/opencode-design-docs',
  '@neottia/opencode-searchable',
];
for (const packageName of extensionPackages) {
  const extension = await import(packageName);
  assert.equal(typeof extension.default, 'function', `${packageName} has no loadable default entry point`);
}

const issues = new IssueStore(loadIssueConfig(project, { env: {} }), project);
const issue = await issues.create({
  type: 'story',
  title: 'External package acceptance',
  body: 'Prove the packed Issues package on the certified platform.',
  created_by: 'external-consumer',
});
assert.ok((await issues.list()).some((entry) => entry.id === issue.id));

const documents = await DesignDocumentStore.fromConfig(loadDesignDocsConfig(project, { env: {} }), project);
const document = await documents.create({
  title: 'External package design',
  kind: 'hld',
  body: 'The clean project uses packed Neottia packages.',
  created_by: 'external-consumer',
});
assert.ok((await documents.list()).some((entry) => entry.id === document.id));

const memory = MemoryStore.fromConfig(loadMemoryConfig(project, { env: {} }), project);
try {
  const record = await memory.store({
    memory_type: 'semantic',
    record_type: 'fact',
    topic: 'external-acceptance',
    summary: 'Packed Neottia packages completed the external consumer journey.',
    source: { kind: 'user-confirmed', ref: null, revision: null },
    created_by: 'external-consumer',
    confidence: 'confirmed',
    tags: ['acceptance'],
  });
  assert.ok((await memory.list({ topic: 'external-acceptance' })).some((entry) => entry.id === record.id));
} finally {
  await memory.close();
}

const searchable = SearchableStore.fromConfig(loadSearchableConfig(project, { enabled: true, env: {} }), project);
try {
  const stashed = await searchable.stash({
    url: 'https://example.test/external-acceptance',
    title: 'External acceptance',
    content: 'Packed Searchable records and retrieves this deterministic offline page.',
  });
  assert.equal(stashed.stashed, true);
  const results = await searchable.grep({ query: 'deterministic offline page', limit: 5 });
  assert.ok(results.results.some((entry) => entry.url === 'https://example.test/external-acceptance'));
} finally {
  await searchable.close?.();
}

const installedStore = await import.meta.resolve('@neottia/repository-store');
const storeRoot = new URL('../', installedStore);
const receipt = JSON.parse(
  await readFile(new URL('build/Release/repository_store_native.integrity.json', storeRoot), 'utf8'),
);
assert.equal(receipt.origin, origin);

console.log(`external consumer journey passed with ${origin}`);
