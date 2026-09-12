import { findSearchableTool, type SearchableServices } from '@neottia/searchable-core';

/** Runs all five contracts with deterministic caller-owned services. */
export async function runSearchableMock(cwd = process.cwd()) {
  const url = 'https://example.com/guide';
  const services: SearchableServices = {
    search: async () => ({
      results: [{ title: 'Guide', url, snippet: 'Deployment guide' }],
    }),
    fetch: async () => ({
      title: 'Guide',
      content: 'Deploy with pnpm.',
      url,
      source: 'direct',
    }),
    stash: async (input) => ({ stashed: true, url: input.url }),
    grep: async () => ({
      results: [{ url, title: 'Guide', snippet: 'pnpm', rank: 1 }],
    }),
    ask: async () => ({ answer: 'Use pnpm.', contextUrls: [url] }),
  };
  const context = { cwd, services, configOverrides: { enabled: true } };

  // Checked lookup makes a registry mismatch fail instead of becoming a no-op.
  const tool = (name: string) => {
    const definition = findSearchableTool(name);
    if (!definition) throw new Error(`Missing Searchable tool: ${name}`);
    return definition;
  };
  const output = {
    search: await tool('web_search').run(context, { query: 'deploy' }),
    fetch: await tool('web_fetch').run(context, { url }),
    stash: await tool('web_stash').run(context, {
      url,
      title: 'Guide',
      content: 'Deploy with pnpm.',
    }),
    grep: await tool('web_grep').run(context, { query: 'pnpm' }),
    ask: await tool('web_ask').run(context, { question: 'How do I deploy?' }),
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}
