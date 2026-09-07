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
      { text: 'Memory', link: '/memory/' },
    ],
    sidebar: {
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
