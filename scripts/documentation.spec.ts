import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  closeDesignDocsToolContext,
  designDocsConfigSchema,
  DESIGN_DOCS_TOOLS,
  findDesignDocsTool,
} from '@neottia/design-docs';
import { createDesignDocsServer } from '@neottia/design-docs-mcp';
import { closeIssueToolContext, findIssueTool, ISSUE_TOOLS, issueConfigSchema } from '@neottia/issues';
import { createIssuesDesignDocsComposition } from '@neottia/issues-design-docs';
import { createIssueServer } from '@neottia/issues-mcp';
import { closeMemoryToolContext, findMemoryTool, memoryConfigFileSchema, MEMORY_TOOLS } from '@neottia/memory-core';
import { createMemoryServer } from '@neottia/memory-mcp';
import { SEARCHABLE_TOOLS, searchableConfigFileSchema } from '@neottia/searchable-core';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { runSearchableMock } from '../docs/examples/searchable-mock.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const catalogPath = join(docs, 'module-catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as CatalogEntry[];
const connected: Array<{ client: Client; server: { close(): Promise<void> } }> = [];

interface CatalogEntry {
  readonly name: string;
  readonly manifest: string;
  readonly classification: string;
  readonly route: string | null;
  readonly disposition?: string;
}

// Close protocol peers after every test so no tool context survives the contract run.
afterEach(async () => {
  await Promise.all(
    connected.splice(0).map(async ({ client, server }) => {
      await client.close();
      await server.close();
    }),
  );
});

/** Recursively returns files matching one extension without entering generated trees. */
function filesBelow(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (['dist', 'node_modules', '.vitepress'].includes(entry.name)) return [];
      return filesBelow(path, extension);
    }
    return entry.name.endsWith(extension) ? [path] : [];
  });
}

/** Converts a clean VitePress route into the Markdown file that owns it. */
function routeFile(route: string): { file: string; fragment: string } {
  const [pathPart = '', fragment = ''] = route.split('#', 2);
  const decoded = decodeURIComponent(pathPart.split('?')[0] ?? '');
  if (decoded === '/' || decoded === '') return { file: join(docs, 'index.md'), fragment };
  const local = decoded.startsWith('/') ? decoded.slice(1) : decoded;
  const base = join(docs, local);
  if (extname(base)) return { file: base, fragment };
  if (decoded.endsWith('/')) return { file: join(base, 'index.md'), fragment };
  if (existsSync(`${base}.md`)) return { file: `${base}.md`, fragment };
  return { file: join(base, 'index.md'), fragment };
}

/** Implements the heading IDs used by this documentation's simple Markdown headings. */
function headingIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of markdown.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/u.exec(line);
    if (!match?.[1]) continue;
    const explicit = /\s+\{#([^}]+)\}$/u.exec(match[1]);
    const base =
      explicit?.[1] ??
      match[1]
        .replace(/`/gu, '')
        .toLocaleLowerCase('en-US')
        .replace(/<[^>]*>/gu, '')
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
        .trim()
        .replace(/\s+/gu, '-');
    const count = counts.get(base) ?? 0;
    ids.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return ids;
}

/** Resolves a local Markdown link from a source file using repository and VitePress rules. */
function markdownTarget(source: string, href: string): { file: string; fragment: string } | undefined {
  const repositoryPrefix = 'https://github.com/dragoscirjan/neottia/blob/main/';
  const localHref = href.startsWith(repositoryPrefix) ? href.slice(repositoryPrefix.length) : href;
  if (/^(?:[a-z]+:|\/\/)/iu.test(localHref)) return undefined;
  const [pathPart = '', fragment = ''] = localHref.split('#', 2);
  if (!pathPart) return { file: source, fragment };
  if (pathPart.startsWith('/')) return routeFile(localHref);
  const clean = decodeURIComponent(pathPart.split('?')[0] ?? '');
  const base = href.startsWith(repositoryPrefix) ? resolve(root, clean) : resolve(dirname(source), clean);
  if (!base.startsWith(root)) throw new Error(`${relative(root, source)}: link escapes repository: ${href}`);
  if (existsSync(base) && extname(base)) return { file: base, fragment };
  if (existsSync(base) && !extname(base)) {
    const statIndex = join(base, basename(source) === 'README.md' ? 'README.md' : 'index.md');
    if (existsSync(statIndex)) return { file: statIndex, fragment };
  }
  if (!extname(base) && existsSync(`${base}.md`)) return { file: `${base}.md`, fragment };
  if (!extname(base) && existsSync(join(base, 'index.md'))) return { file: join(base, 'index.md'), fragment };
  return { file: base, fragment };
}

/** Extracts fenced JSON and YAML blocks with their starting line. */
function fencedBlocks(markdown: string): Array<{ language: string; content: string; line: number }> {
  const blocks: Array<{ language: string; content: string; line: number }> = [];
  const pattern = /^```(json|ya?ml)\s*\n([\s\S]*?)^```\s*$/gmu;
  for (const match of markdown.matchAll(pattern)) {
    blocks.push({
      language: match[1] as string,
      content: match[2] as string,
      line: markdown.slice(0, match.index).split('\n').length,
    });
  }
  return blocks;
}

/** Expands the repository's current one-level pnpm workspace patterns. */
function workspaceManifests(): string[] {
  const workspace = parseDocument(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'), {
    strict: true,
    uniqueKeys: true,
  }).toJS() as { packages?: string[] };
  return (workspace.packages ?? []).flatMap((pattern) => {
    const match = /^(.*)\/\*$/u.exec(pattern);
    if (!match?.[1]) throw new Error(`Unsupported workspace pattern in documentation check: ${pattern}`);
    return readdirSync(join(root, match[1]), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, match[1] as string, entry.name, 'package.json')))
      .map((entry) => `${match[1]}/${entry.name}/package.json`);
  });
}

/** Parses the first-column tool names from the canonical table. */
function documentedTools(path: string): string[] {
  return readFileSync(join(root, path), 'utf8')
    .split('\n')
    .map((line) => /^\|\s*`([^`]+)`\s*\|/u.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
}

describe('documentation contracts', () => {
  it('catalogues every workspace manifest exactly once', () => {
    const manifests = workspaceManifests();
    expect(catalog.map((entry) => entry.manifest).sort()).toEqual(manifests.sort());
    expect(new Set(catalog.map((entry) => entry.name)).size).toBe(catalog.length);
    for (const entry of catalog) {
      const manifest = JSON.parse(readFileSync(join(root, entry.manifest), 'utf8')) as {
        name: string;
        private?: boolean;
      };
      expect(entry.name).toBe(manifest.name);
      expect(['library/embedding', 'native extension', 'generic MCP', 'foundation-only', 'internal/private']).toContain(
        entry.classification,
      );
      expect(entry.route ?? entry.disposition).toBeTruthy();
      expect(manifest.private === true || Boolean(entry.route)).toBe(true);
    }
  });

  it('keeps every visible module field aligned with the catalog', () => {
    const page = readFileSync(join(docs, 'reference/modules.md'), 'utf8');
    const rows = page.split('\n').filter((line) => /^\|\s*`@neottia\//u.test(line));
    expect(rows).toHaveLength(catalog.length);
    for (const [index, entry] of catalog.entries()) {
      const row = rows[index] as string;
      expect(row).toContain(`\`${entry.name}\``);
      expect(row).toContain(entry.classification);
      const destination = entry.route ? `(${entry.route})` : (entry.disposition as string);
      expect(row).toContain(destination);
    }
  });

  it('resolves VitePress navigation and all local Markdown links', () => {
    const diagnostics: string[] = [];
    const config = readFileSync(join(docs, '.vitepress/config.ts'), 'utf8');
    const navigation = [...config.matchAll(/link:\s*'([^']+)'/gu)].map((match) => match[1] as string);
    const markdownFiles = [
      join(root, 'README.md'),
      join(root, 'CONTRIBUTING.md'),
      join(root, '.changeset/README.md'),
      ...filesBelow(docs, '.md'),
      ...filesBelow(join(root, 'packages'), 'README.md'),
      ...filesBelow(join(root, 'extensions'), 'README.md'),
    ].filter(existsSync);
    for (const route of navigation) {
      if (/^(?:[a-z]+:|\/\/)/iu.test(route)) continue;
      const target = routeFile(route);
      if (!existsSync(target.file)) diagnostics.push(`docs/.vitepress/config.ts: missing ${route}`);
      else if (target.fragment && !headingIds(readFileSync(target.file, 'utf8')).has(target.fragment))
        diagnostics.push(`docs/.vitepress/config.ts: missing anchor ${route}`);
    }
    for (const source of markdownFiles) {
      const markdown = readFileSync(source, 'utf8').replace(/^```[\s\S]*?^```\s*$/gmu, '');
      for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/gu)) {
        const href = match[1] as string;
        try {
          const target = markdownTarget(source, href);
          if (!target) continue;
          if (!existsSync(target.file)) diagnostics.push(`${relative(root, source)}: missing ${href}`);
          else if (target.fragment && !headingIds(readFileSync(target.file, 'utf8')).has(target.fragment))
            diagnostics.push(`${relative(root, source)}: missing anchor ${href}`);
        } catch (error: unknown) {
          diagnostics.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    expect(diagnostics).toEqual([]);
  });

  it('parses JSON and YAML examples and validates configuration shards', () => {
    const diagnostics: string[] = [];
    for (const file of [
      join(root, 'README.md'),
      ...filesBelow(docs, '.md'),
      ...filesBelow(join(root, 'packages'), 'README.md'),
      ...filesBelow(join(root, 'extensions'), 'README.md'),
    ]) {
      const markdown = readFileSync(file, 'utf8');
      for (const block of fencedBlocks(markdown)) {
        try {
          if (block.language === 'json') JSON.parse(block.content);
          else {
            const document = parseDocument(block.content, { strict: true, uniqueKeys: true });
            if (document.errors.length) throw new Error(document.errors.map((error) => error.message).join('; '));
            const value = document.toJS() as { version?: unknown; skills?: Record<string, unknown> } | undefined;
            if (value?.skills || value?.version !== undefined) {
              if (value.version !== 1) throw new Error('configuration root must use version: 1');
              const skills = value.skills ?? {};
              const checks = [
                ['memory', memoryConfigFileSchema.partial()],
                ['issues', issueConfigSchema.partial()],
                ['design_docs', designDocsConfigSchema.partial()],
                ['searchable', searchableConfigFileSchema.partial()],
              ] as const;
              for (const [name, schema] of checks) {
                if (skills[name] === undefined) continue;
                const result = schema.safeParse(skills[name]);
                if (!result.success) throw new Error(`${name}: ${result.error.message}`);
              }
            }
          }
        } catch (error: unknown) {
          diagnostics.push(
            `${relative(root, file)}:${block.line}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    expect(diagnostics).toEqual([]);
  });

  it('keeps generated configuration schemas aligned with source', () => {
    const schemas = [
      ['packages/memory-core/config.schema.json', memoryConfigFileSchema.toJSONSchema({ io: 'input' })],
      ['packages/issues/config.schema.json', issueConfigSchema.toJSONSchema()],
      ['packages/design-docs/config.schema.json', designDocsConfigSchema.toJSONSchema({ io: 'input' })],
      ['packages/searchable-core/config.schema.json', searchableConfigFileSchema.toJSONSchema({ io: 'input' })],
    ] as const;
    for (const [path, generated] of schemas) {
      expect(JSON.parse(readFileSync(join(root, path), 'utf8'))).toEqual(generated);
    }
  });

  it('matches every canonical tool table to its source registry', () => {
    expect(documentedTools('docs/memory/tools.md')).toEqual(MEMORY_TOOLS.map((tool) => tool.name));
    expect(documentedTools('docs/issues/tools.md')).toEqual(ISSUE_TOOLS.map((tool) => tool.name));
    expect(documentedTools('docs/design-docs/tools.md')).toEqual(DESIGN_DOCS_TOOLS.map((tool) => tool.name));
    expect(documentedTools('docs/searchable/tools.md')).toEqual(SEARCHABLE_TOOLS.map((tool) => tool.name));
  });

  it('keeps documented MCP package commands installable', () => {
    const documented = new Set<string>();
    for (const file of filesBelow(docs, '.md')) {
      const markdown = readFileSync(file, 'utf8');
      for (const match of markdown.matchAll(/@neottia\/[a-z-]+-mcp/gu)) documented.add(match[0]);
    }
    expect([...documented].sort()).toEqual(['@neottia/design-docs-mcp', '@neottia/issues-mcp', '@neottia/memory-mcp']);
    for (const name of documented) {
      const entry = catalog.find((candidate) => candidate.name === name);
      expect(entry?.classification).toBe('generic MCP');
      const manifest = JSON.parse(readFileSync(join(root, entry?.manifest as string), 'utf8')) as { bin?: unknown };
      expect(manifest.bin).toBeTruthy();
    }
  });

  it('matches all MCP tools/list results to the shared registries', async () => {
    const cases = [
      [createMemoryServer(), MEMORY_TOOLS],
      [createIssueServer(), ISSUE_TOOLS],
      [createDesignDocsServer(), DESIGN_DOCS_TOOLS],
    ] as const;
    for (const [server, registry] of cases) {
      const client = new Client({ name: 'documentation-contract', version: '1' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      connected.push({ client, server });
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(registry.map((tool) => tool.name));
    }
  });

  it('runs documented first success and the complete composition workflow in a temporary project', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'neottia-documentation-'));
    const memoryContext = { cwd, interactive: false, storeKey: {} };
    const composition = createIssuesDesignDocsComposition({ cwd });
    const issueContext = { cwd, interactive: false, storeKey: {}, resolver: composition.resolver };
    const documentContext = { cwd, interactive: false, storeKey: {}, linkValidator: composition.linkValidator };
    const runMemory = async (name: string, input: unknown) => {
      const tool = findMemoryTool(name);
      if (!tool) throw new Error(`Missing Memory tool: ${name}`);
      return tool.run(memoryContext, input);
    };
    const runIssue = async (name: string, input: unknown) => {
      const tool = findIssueTool(name);
      if (!tool) throw new Error(`Missing Issues tool: ${name}`);
      return tool.run(issueContext, input);
    };
    const runDocument = async (name: string, input: unknown) => {
      const tool = findDesignDocsTool(name);
      if (!tool) throw new Error(`Missing Design Docs tool: ${name}`);
      return tool.run(documentContext, input);
    };
    try {
      mkdirSync(join(cwd, '.neottia'), { recursive: true });
      writeFileSync(
        join(cwd, '.neottia/config.yml'),
        'version: 1\nskills:\n  memory:\n    enabled: true\n  issues:\n    enabled: true\n  design_docs:\n    enabled: true\n',
      );
      const inputs = fencedBlocks(readFileSync(join(docs, 'get-started/first-success.md'), 'utf8'))
        .filter((block) => block.language === 'json')
        .map((block) => JSON.parse(block.content) as Record<string, unknown>);
      expect(inputs).toHaveLength(3);
      const memory = (await runMemory('memory_store', inputs[0])) as { id: string; summary: string };
      const issue = (await runIssue('issue_create', inputs[1])) as { id: string; revision: string; title: string };
      const draft = (await runDocument('document_create', inputs[2])) as {
        id: string;
        path: string;
        revision: string;
        title: string;
      };
      expect(existsSync(join(cwd, `.neottia/memory/facts/${memory.id}.yaml`))).toBe(true);
      expect(
        readdirSync(join(cwd, '.neottia/issues')).some(
          (name) => name.startsWith(`${issue.id}-`) && name.endsWith('.yml'),
        ),
      ).toBe(true);
      expect(existsSync(join(cwd, draft.path))).toBe(true);

      const linked = (await runIssue('issue_link_document', {
        id: issue.id,
        document_id: draft.id,
        expected_revision: issue.revision,
      })) as { id: string; revision: string };
      const review = (await runDocument('document_transition', {
        id: draft.id,
        expected_revision: draft.revision,
        to: 'review',
        intent: 'Request review of the deployment design.',
        actor: 'user:owner',
        evidence: { source: 'caller-attestation', note: 'The owner requested review in this session.' },
      })) as { id: string; revision: string };
      expect(await runDocument('document_validate', { cross_domain: true })).toMatchObject({ valid: true });
      const approved = (await runDocument('document_transition', {
        id: review.id,
        expected_revision: review.revision,
        to: 'approved',
        intent: 'Approve the reviewed deployment design.',
        actor: 'user:owner',
        evidence: { source: 'caller-attestation', note: 'The owner approved this revision.' },
      })) as { id: string; revision: string; version: number };
      const unlinked = (await runIssue('issue_unlink_document', {
        id: linked.id,
        document_id: approved.id,
        expected_revision: linked.revision,
      })) as { id: string; revision: string };
      const pinned = (await runIssue('issue_link_document', {
        id: unlinked.id,
        document_id: approved.id,
        document_version: approved.version,
        expected_revision: unlinked.revision,
      })) as { id: string; revision: string; links: Array<{ version?: number }> };
      const successor = (await runDocument('document_version', {
        id: approved.id,
        expected_revision: approved.revision,
        body: 'Describe the data sources, update interval, and incident state.',
      })) as { version: number; status: string };
      const done = (await runIssue('issue_transition', {
        id: pinned.id,
        status: 'done',
        expected_revision: pinned.revision,
      })) as { status: string };
      const decision = await runMemory('memory_store', {
        memory_type: 'episodic',
        record_type: 'decision',
        summary: 'Use the approved deployment status design.',
        source: { kind: 'artifact', ref: approved.id, revision: approved.revision },
        created_by: 'user:owner',
        confidence: 'verified',
        tags: ['deployment'],
      });
      expect(done.status).toBe('done');
      expect(successor).toMatchObject({ version: 2, status: 'draft' });
      expect(pinned.links).toContainEqual(expect.objectContaining({ version: 1 }));
      expect(decision).toMatchObject({ record_type: 'decision', source: { ref: approved.id } });
      expect(await runMemory('memory_validate', {})).toMatchObject({ valid: true });
      expect(await runIssue('issue_validate', {})).toMatchObject({ valid: true });
      expect(existsSync(join(cwd, '.neottia/memory/index.db'))).toBe(true);
      expect(existsSync(join(cwd, '.neottia/cache/issues.sqlite'))).toBe(true);
      expect(existsSync(join(cwd, '.neottia/cache/design-docs.sqlite'))).toBe(true);
      expect(await runSearchableMock(cwd)).toMatchObject({
        search: { results: [{ url: 'https://example.com/guide' }] },
        stash: { stashed: true },
      });
    } finally {
      await Promise.all([
        closeMemoryToolContext(memoryContext),
        closeIssueToolContext(issueContext),
        closeDesignDocsToolContext(documentContext),
      ]);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('keeps the root README capability and delivery summary present', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    for (const capability of ['Memory', 'Issues', 'Design Docs', 'Searchable foundation']) {
      expect(readme).toContain(`## ${capability}`);
    }
    expect(readme).toContain('Pi and OpenCode each have native');
    expect(readme).toContain('generic stdio servers');
    expect(readme).toContain('docs/reference/modules.md');
  });

  it('keeps published README destinations aligned with the catalog', () => {
    for (const entry of catalog.filter((candidate) => candidate.route)) {
      const readme = join(root, dirname(entry.manifest), 'README.md');
      expect(existsSync(readme), `${entry.name} has a README`).toBe(true);
      const expectedPath = (entry.route as string).split('#')[0]?.replace(/^\//u, '');
      const candidates = expectedPath?.endsWith('/')
        ? [`docs/${expectedPath}index.md`, `docs/${expectedPath}`]
        : [`docs/${expectedPath}.md`, `docs/${expectedPath}`];
      const text = readFileSync(readme, 'utf8');
      expect(
        candidates.some((candidate) => text.includes(candidate)),
        `${entry.name} links to ${entry.route}`,
      ).toBe(true);
    }
  });
});
