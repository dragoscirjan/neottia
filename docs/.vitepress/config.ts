import { defineConfig } from 'vitepress';

// Keep user-facing documentation configuration close to the Markdown content.
export default defineConfig({
  title: 'Neottia',
  description: 'A shared SDLC for AI coding harnesses',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Design Docs', link: '/design-docs/' },
      { text: 'Memory', link: '/memory/' },
      { text: 'Issues', link: '/issues/' },
      { text: 'Repository store', link: '/repository-store' },
    ],
    sidebar: {
      '/design-docs/': [
        {
          text: 'Design Docs',
          items: [{ text: 'Overview and operations', link: '/design-docs/' }],
        },
      ],
      '/issues/': [
        {
          text: 'Issues',
          items: [
            { text: 'Overview', link: '/issues/' },
            { text: 'Configuration', link: '/issues/configuration' },
            { text: 'Canonical format', link: '/issues/canonical-format' },
            { text: 'Tools', link: '/issues/tools' },
            { text: 'Search and operations', link: '/issues/operations' },
            { text: 'Migration', link: '/issues/migration' },
          ],
        },
      ],
      '/memory/': [
        {
          text: 'Memory',
          items: [
            { text: 'Overview', link: '/memory/' },
            { text: 'Configuration', link: '/memory/configuration' },
            { text: 'Records and storage', link: '/memory/records' },
            { text: 'Tool contract', link: '/memory/tools' },
            { text: 'Using memory over MCP', link: '/memory/mcp-server' },
            { text: 'Security and operations', link: '/memory/operations' },
          ],
        },
      ],
    },
    search: {
      provider: 'local',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/dragoscirjan/neottia' }],
  },
});
